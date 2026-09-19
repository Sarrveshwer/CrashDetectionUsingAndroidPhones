package com.example.crashdetection.ml

/**
 * Centralized configuration for the TFLite model.
 * These values can be updated once the final trained model is provided.
 */
object ModelConfig {
    // Path to the model in the assets folder
    const val MODEL_PATH = "model.tflite"
    
    // Input dimensions expected by the model
    const val INPUT_SIZE = 224 // Standard for many image classification models
    
    // Number of color channels (3 for RGB)
    const val NUM_CHANNELS = 3
    
    // Normalization parameters (values between 0 and 1 or -1 and 1)
    const val IMAGE_MEAN = 0f
    const val IMAGE_STD = 255f
    
    // Confidence threshold to report a detection
    const val CONFIDENCE_THRESHOLD = 0.5f
    
    // Temporary class names for the test model
    val CLASS_NAMES = listOf("NORMAL", "ACCIDENT")
}
