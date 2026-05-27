const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

const RENDER_ML_URL = process.env.RENDER_ML_URL || "";

/**
 * onNewSensorReading — Firestore trigger
 *
 * Fires whenever a document is created in sensor_readings/{readingId}.
 * Calls the Render.com FastAPI ML service (or falls back to GHG rule-based)
 * and writes the prediction to predictions/{readingId}.
 */
exports.onNewSensorReading = onDocumentCreated(
  "sensor_readings/{readingId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    const readingId = event.params.readingId;

    const sensorPayload = {
      co2_ppm:     data.co2_ppm     || 420,
      ch4_ppm:     data.ch4_ppm     || 1.9,
      temperature: data.temperature || 25,
      humidity:    data.humidity    || 60,
      energy_kwh:  data.energy_kwh  || 0,
      facility_id: data.facility_id || "",
    };

    let prediction;

    if (RENDER_ML_URL) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`${RENDER_ML_URL}/predict`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(sensorPayload),
          signal:  controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) throw new Error(`Render returned ${response.status}`);
        const result = await response.json();
        prediction = result.prediction;
        logger.info("ML prediction stored", { readingId, predicted: prediction?.predicted_co2e_kg });
      } catch (err) {
        logger.warn("Render.com unavailable, using rule-based fallback", { err: String(err) });
        prediction = ruleBasedFallback(sensorPayload).prediction;
      }
    } else {
      logger.warn("RENDER_ML_URL not set, using rule-based fallback");
      prediction = ruleBasedFallback(sensorPayload).prediction;
    }

    await db.collection("predictions").doc(readingId).set({
      reading_id:  readingId,
      facility_id: data.facility_id || "",
      device_id:   data.device_id   || "",
      sensor:      sensorPayload,
      prediction,
      timestamp:   data.timestamp   || new Date().toISOString(),
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    });
  }
);

/**
 * predictEmissions — HTTP endpoint
 *
 * Kept for direct testing and Next.js /api/predict fallback.
 * POST body: { co2_ppm, ch4_ppm, temperature, humidity, energy_kwh, ... }
 */
exports.predictEmissions = onRequest(
  { cors: true },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST required" });
      return;
    }

    const required = ["co2_ppm", "ch4_ppm", "temperature", "humidity", "energy_kwh"];
    const missing  = required.filter((f) => req.body[f] === undefined);
    if (missing.length > 0) {
      res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
      return;
    }

    if (!RENDER_ML_URL) {
      res.status(200).json(ruleBasedFallback(req.body));
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${RENDER_ML_URL}/predict`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(req.body),
        signal:  controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`Render returned ${response.status}`);
      const data = await response.json();
      logger.info("ML prediction", { predicted: data?.prediction?.predicted_co2e_kg });
      res.status(200).json(data);
    } catch (err) {
      logger.error("ML service error, using fallback", { err: String(err) });
      res.status(200).json(ruleBasedFallback(req.body));
    }
  }
);

function ruleBasedFallback(body) {
  const ZESA = 0.92, CH4_GWP = 28, CH4_D = 0.657, CO2_D = 1.977, VOL = 100;
  const co2 = Number(body.co2_ppm)    || 420;
  const ch4 = Number(body.ch4_ppm)    || 1.9;
  const kwh = Number(body.energy_kwh) || 0;

  const ch4Excess    = Math.max(0, ch4 - 1.9);
  const ch4Scope1    = (ch4Excess / 1e6) * VOL * CH4_D * CH4_GWP;
  const co2Excess    = Math.max(0, co2 - 420);
  const co2Direct    = (co2Excess / 1e6) * VOL * CO2_D;
  const energyScope2 = kwh * ZESA;
  const total        = ch4Scope1 + co2Direct + energyScope2;

  return {
    success: true,
    prediction: {
      predicted_co2e_kg: parseFloat(total.toFixed(6)),
      confidence_lower:  parseFloat((total * 0.95).toFixed(6)),
      confidence_upper:  parseFloat((total * 1.05).toFixed(6)),
      breakdown: {
        energy_scope2_kg: parseFloat(energyScope2.toFixed(6)),
        ch4_scope1_kg:    parseFloat(ch4Scope1.toFixed(6)),
        co2_direct_kg:    parseFloat(co2Direct.toFixed(6)),
      },
      model_version: "rule-based-ghg-fallback",
      method:        "rule_based",
    },
    timestamp: new Date().toISOString(),
  };
}
