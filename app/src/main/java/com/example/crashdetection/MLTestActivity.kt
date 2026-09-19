package com.example.crashdetection

import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.util.Log
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.example.crashdetection.ml.ModelConfig
import com.example.crashdetection.ml.TFLiteInferenceManager

class MLTestActivity : AppCompatActivity() {

    private lateinit var inferenceManager: TFLiteInferenceManager
    private var selectedBitmap: Bitmap? = null

    private lateinit var previewImage: ImageView
    private lateinit var modelStatusText: TextView
    private lateinit var predictionText: TextView
    private lateinit var confidenceText: TextView
    private lateinit var timeText: TextView

    private val selectImageLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let {
            try {
                selectedBitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    val source = ImageDecoder.createSource(contentResolver, it)
                    ImageDecoder.decodeBitmap(source) { decoder, _, _ ->
                        decoder.isMutableRequired = true
                    }
                } else {
                    @Suppress("DEPRECATION")
                    MediaStore.Images.Media.getBitmap(contentResolver, it)
                }
                previewImage.setImageBitmap(selectedBitmap)
                resetResults()
            } catch (e: Exception) {
                Toast.makeText(this, "Error loading image: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_ml_test)

        previewImage = findViewById(R.id.previewImage)
        modelStatusText = findViewById(R.id.modelStatusText)
        predictionText = findViewById(R.id.predictionText)
        confidenceText = findViewById(R.id.confidenceText)
        timeText = findViewById(R.id.timeText)

        findViewById<Button>(R.id.selectImageButton).setOnClickListener {
            selectImageLauncher.launch("image/*")
        }

        findViewById<Button>(R.id.runInferenceButton).setOnClickListener {
            runInference()
        }

        inferenceManager = TFLiteInferenceManager(this)
        loadModel()
    }

    private fun loadModel() {
        val result = inferenceManager.loadModel()
        if (result.isSuccess) {
            modelStatusText.text = "Model: Loaded (${ModelConfig.MODEL_PATH})"
            modelStatusText.setTextColor(getColor(android.R.color.holo_green_dark))
            Log.d("MLTest", "Model loaded successfully")
        } else {
            val error = result.exceptionOrNull()?.message ?: "Unknown error"
            modelStatusText.text = "Model: Load Failed"
            modelStatusText.setTextColor(getColor(android.R.color.holo_red_dark))
            Log.e("MLTest", "Model load failed: $error", result.exceptionOrNull())
            Toast.makeText(this, "Model Error: $error", Toast.LENGTH_LONG).show()
        }
    }

    private fun runInference() {
        val bitmap = selectedBitmap
        if (bitmap == null) {
            Toast.makeText(this, "Please select an image first", Toast.LENGTH_SHORT).show()
            return
        }

        if (!inferenceManager.isLoaded()) {
            Toast.makeText(this, "Model not loaded", Toast.LENGTH_SHORT).show()
            return
        }

        val result = inferenceManager.runInference(bitmap)
        if (result.isSuccess) {
            val (probs, time) = result.getOrThrow()
            displayResults(probs, time)
        } else {
            val error = result.exceptionOrNull()?.message ?: "Unknown error"
            Log.e("MLTest", "Inference failed: $error", result.exceptionOrNull())
            Toast.makeText(this, "Inference Error: $error", Toast.LENGTH_SHORT).show()
        }
    }

    private fun displayResults(probabilities: List<Float>, time: Long) {
        val maxProb = probabilities.maxOrNull() ?: 0f
        val maxIndex = probabilities.indexOf(maxProb)
        val label = if (maxIndex in ModelConfig.CLASS_NAMES.indices) {
            ModelConfig.CLASS_NAMES[maxIndex]
        } else {
            "Unknown ($maxIndex)"
        }

        predictionText.text = "Prediction: $label"
        confidenceText.text = "Confidence: ${(maxProb * 100).toInt()}%"
        timeText.text = "Inference Time: $time ms"
    }

    private fun resetResults() {
        predictionText.text = "Prediction: --"
        confidenceText.text = "Confidence: --"
        timeText.text = "Inference Time: -- ms"
    }

    override fun onDestroy() {
        super.onDestroy()
        inferenceManager.close()
    }
}
