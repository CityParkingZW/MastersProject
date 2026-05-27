const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");

setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

// Set this to your Render.com URL after deploying ml-service/
// e.g. https://carbon-ml-harare.onrender.com
const RENDER_ML_URL = process.env.RENDER_ML_URL || "";

/**
 * predictEmissions — HTTP Cloud Function
 *
 * Accepts a sensor reading and forwards it to the Render.com
 * FastAPI ML service. Falls back to GHG Protocol rule-based
 * calculation if Render.com is unavailable.
 *
 * POST body: { co2_ppm, ch4_ppm, temperature, humidity, energy_kwh,
 *              facility_id?, hour?, month?, is_weekend?, zesa_online? }
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
      logger.warn("RENDER_ML_URL not set — returning rule-based fallback");
      res.status(200).json(ruleBasedFallback(req.body));
      return;
    }

    try {
      const response = await fetch(`${RENDER_ML_URL}/predict`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(req.body),
      });

      if (!response.ok) {
        throw new Error(`Render.com returned ${response.status}`);
      }

      const data = await response.json();
      logger.info("ML prediction", { predicted: data?.prediction?.predicted_co2e_kg });
      res.status(200).json(data);

    } catch (err) {
      logger.error("ML service error, falling back to rule-based", { err: String(err) });
      res.status(200).json(ruleBasedFallback(req.body));
    }
  }
);

// GHG Protocol fallback used when Render.com is unavailable
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
