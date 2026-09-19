package com.example.crashdetection.ml

import android.content.Context
import android.graphics.Bitmap
import android.os.SystemClock
import org.tensorflow.lite.Interpreter
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.io.FileInputStream

class TFLiteInferenceManager(private val context: Context) {

    private var interpreter: Interpreter? = null
    private var isModelLoaded = false

    /**
     * Loads the TFLite model from assets.
     */
    fun loadModel(modelPath: String = ModelConfig.MODEL_PATH): Result<Unit> {
        return try {
            val fileDescriptor = context.assets.openFd(modelPath)
            val inputStream = FileInputStream(fileDescriptor.fileDescriptor)
            val fileChannel = inputStream.channel
            val startOffset = fileDescriptor.startOffset
            val declaredLength = fileDescriptor.length
            val modelBuffer = fileChannel.map(FileChannel.MapMode.READ_ONLY, startOffset, declaredLength)
            
            val options = Interpreter.Options()
            interpreter = Interpreter(modelBuffer, options)
            isModelLoaded = true
            Result.success(Unit)
        } catch (e: Exception) {
            isModelLoaded = false
            Result.failure(e)
        }
    }

    /**
     * Runs inference on the provided Bitmap.
     * Returns a pair of (List of probabilities, Inference time in ms).
     */
    fun runInference(bitmap: Bitmap): Result<Pair<List<Float>, Long>> {
        val tInterpreter = interpreter ?: return Result.failure(IllegalStateException("Interpreter not initialized"))

        return try {
            // 1. Preprocess the image (Manual Resize and Normalization)
            val scaledBitmap = Bitmap.createScaledBitmap(bitmap, ModelConfig.INPUT_SIZE, ModelConfig.INPUT_SIZE, true)
            val inputBuffer = ByteBuffer.allocateDirect(1 * ModelConfig.INPUT_SIZE * ModelConfig.INPUT_SIZE * 3 * 4)
            inputBuffer.order(ByteOrder.nativeOrder())
            
            val intValues = IntArray(ModelConfig.INPUT_SIZE * ModelConfig.INPUT_SIZE)
            scaledBitmap.getPixels(intValues, 0, scaledBitmap.width, 0, 0, scaledBitmap.width, scaledBitmap.height)
            
            for (pixelValue in intValues) {
                inputBuffer.putFloat(((pixelValue shr 16 and 0xFF) - ModelConfig.IMAGE_MEAN) / ModelConfig.IMAGE_STD)
                inputBuffer.putFloat(((pixelValue shr 8 and 0xFF) - ModelConfig.IMAGE_MEAN) / ModelConfig.IMAGE_STD)
                inputBuffer.putFloat(((pixelValue and 0xFF) - ModelConfig.IMAGE_MEAN) / ModelConfig.IMAGE_STD)
            }

            // 2. Prepare output buffer
            val outputShape = tInterpreter.getOutputTensor(0).shape()
            val numClasses = if (outputShape.size > 1) outputShape[1] else 1
            val outputBuffer = Array(1) { FloatArray(numClasses) }

            // 3. Run inference and measure time
            val startTime = SystemClock.uptimeMillis()
            tInterpreter.run(inputBuffer, outputBuffer)
            val endTime = SystemClock.uptimeMillis()
            val inferenceTime = endTime - startTime

            // 4. Extract results
            val results = outputBuffer[0].toList()
            Result.success(Pair(results, inferenceTime))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun isLoaded(): Boolean = isModelLoaded

    fun close() {
        interpreter?.close()
        interpreter = null
        isModelLoaded = false
    }
}
