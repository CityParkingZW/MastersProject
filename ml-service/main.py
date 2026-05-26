from fastapi import FastAPI
import joblib
import numpy as np

app = FastAPI()

# Load your trained model
model = joblib.load("carbon_predictor_v1.joblib")

@app.get("/")
def home():
    return {"status": "ML API running"}

@app.post("/predict")
def predict(data: dict):
    features = np.array(data["features"]).reshape(1, -1)
    prediction = model.predict(features)

    return {
        "prediction": prediction.tolist()
    }