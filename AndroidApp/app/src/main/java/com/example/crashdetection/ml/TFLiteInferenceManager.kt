package com.example.crashdetection.ml

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.os.SystemClock
import android.util.Log
import com.accident.Detection
import com.example.crashdetection.utils.AppLogger
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * YOLO TFLite wrapper. Not thread-safe by design: calls are @Synchronized and reuse
 * preallocated buffers, so call it from a single inference thread.
 *
 * Returns detections in the pixel space of the Bitmap passed in (letterboxing is undone).
 * That Bitmap must have the same size/orientation as the Mat given to AccidentEngine.
 */
class TFLiteInferenceManager(
    private val context: Context
) {

    companion object {
        private const val TAG = "TFLiteInference"

        /**
         * End-to-end (NMS-free) exports such as YOLO26 / YOLOv10 emit rows [x1, y1, x2, y2, conf, cls].
         * Set to false if your model's rows are [cx, cy, w, h, conf, cls]. Check the "Raw output sample"
         * log line on the first frame: for xyxy, columns 2/3 are larger than columns 0/1.
         */
        private const val END2END_XYXY = true

        /** Ultralytics defaults, used only for raw (non end-to-end) outputs. */
        private const val NMS_IOU = 0.7f
        private const val MAX_DET = 300

        /** Ultralytics letterbox padding colour. */
        private const val PAD_VALUE = 114
    }

    private enum class OutputLayout { END2END, CHANNEL_MAJOR, ANCHOR_MAJOR }

    private class Box(
        val x1: Float, val y1: Float, val x2: Float, val y2: Float,
        val score: Float, val cls: Int
    )

    private var interpreter: Interpreter? = null
    private var isModelLoaded = false
    private var isNchwInput = false
    private var inputSize = 640

    private var layout = OutputLayout.END2END
    private var outDim1 = 0
    private var outDim2 = 0

    // Preallocated per-model buffers (avoid ~10 MB of garbage per frame).
    private var inputBuffer: ByteBuffer? = null
    private var inputFloats: FloatBuffer? = null
    private var outputBuffer: ByteBuffer? = null
    private var outputFloats: FloatBuffer? = null
    private var outputArray = FloatArray(0)
    private var pixels = IntArray(0)
    private var letterboxBitmap: Bitmap? = null
    private var letterboxCanvas: Canvas? = null
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val dstRect = Rect()
    private val normLut = FloatArray(256)
    private var loggedSample = false

    /**
     * Load the TensorFlow Lite model from assets.
     */
    @Synchronized
    fun loadModel(
        modelPath: String = ModelConfig.MODEL_PATH
    ): Result<Unit> {
        return try {
            releaseResources()

            Log.d(TAG, "Loading model: $modelPath")

            val modelBytes = context.assets.open(modelPath).use { it.readBytes() }
            if (modelBytes.isEmpty()) {
                throw IllegalStateException("Model file is empty: $modelPath")
            }
            Log.d(TAG, "Model size: ${modelBytes.size} bytes")

            val modelBuffer = ByteBuffer.allocateDirect(modelBytes.size)
                .order(ByteOrder.nativeOrder())
            modelBuffer.put(modelBytes)
            modelBuffer.rewind()

            val options = Interpreter.Options().apply { setNumThreads(4) }
            val tflite = Interpreter(modelBuffer, options)
            interpreter = tflite
            tflite.allocateTensors()

            val inputTensor = tflite.getInputTensor(0)
            val inputShape = inputTensor.shape()
            val outputTensor = tflite.getOutputTensor(0)
            val outputShape = outputTensor.shape()

            Log.i(TAG, "Input shape: ${inputShape.contentToString()} type=${inputTensor.dataType()}")
            Log.i(TAG, "Output shape: ${outputShape.contentToString()} type=${outputTensor.dataType()}")
            if (tflite.outputTensorCount > 1) {
                Log.w(TAG, "Model has ${tflite.outputTensorCount} outputs; only output 0 is decoded.")
            }

            // ---- Input: square NCHW [1,3,S,S] or NHWC [1,S,S,3], FLOAT32 ----
            val nchw = inputShape.size == 4 && inputShape[0] == 1 &&
                    inputShape[1] == 3 && inputShape[2] == inputShape[3]
            val nhwc = inputShape.size == 4 && inputShape[0] == 1 &&
                    inputShape[3] == 3 && inputShape[1] == inputShape[2]
            if (!nchw && !nhwc) {
                throw IllegalArgumentException(
                    "Unexpected model input shape: ${inputShape.contentToString()}. " +
                            "Expected [1,3,S,S] (NCHW) or [1,S,S,3] (NHWC)."
                )
            }
            if (inputTensor.dataType() != DataType.FLOAT32) {
                throw IllegalArgumentException(
                    "Unexpected model input type: ${inputTensor.dataType()}. Expected FLOAT32."
                )
            }
            if (outputTensor.dataType() != DataType.FLOAT32) {
                throw IllegalArgumentException(
                    "Unexpected model output type: ${outputTensor.dataType()}. Expected FLOAT32."
                )
            }
            isNchwInput = nchw
            inputSize = if (nchw) inputShape[2] else inputShape[1]

            // ---- Output layout ----
            //   [1, N, 6]        end-to-end (NMS already applied)
            //   [1, 4+C, A]      raw, channel-major (ultralytics export, e.g. [1,84,8400])
            //   [1, A, 4(+1)+C]  raw, anchor-major (e.g. [1,25200,85] with objectness)
            if (outputShape.size < 2) {
                throw IllegalArgumentException("Unexpected output shape: ${outputShape.contentToString()}")
            }
            val d1 = outputShape[outputShape.size - 2]
            val d2 = outputShape[outputShape.size - 1]
            layout = when {
                d2 == 6 -> OutputLayout.END2END
                d1 < d2 -> OutputLayout.CHANNEL_MAJOR
                else -> OutputLayout.ANCHOR_MAJOR
            }
            outDim1 = d1
            outDim2 = d2
            val featureCount = when (layout) {
                OutputLayout.END2END -> 6
                OutputLayout.CHANNEL_MAJOR -> d1
                OutputLayout.ANCHOR_MAJOR -> d2
            }
            if (featureCount < 5) {
                throw IllegalArgumentException(
                    "Unexpected model output shape: ${outputShape.contentToString()}"
                )
            }
            Log.i(TAG, "Output layout: $layout (dim1=$d1, dim2=$d2)")

            // ---- Preallocate buffers ----
            val plane = inputSize * inputSize
            inputBuffer = ByteBuffer.allocateDirect(plane * 3 * 4).order(ByteOrder.nativeOrder())
            inputFloats = inputBuffer!!.asFloatBuffer()

            val outCount = outputShape.fold(1) { acc, d -> acc * d }
            outputBuffer = ByteBuffer.allocateDirect(outCount * 4).order(ByteOrder.nativeOrder())
            outputFloats = outputBuffer!!.asFloatBuffer()
            outputArray = FloatArray(outCount)
            pixels = IntArray(plane)

            val bmp = Bitmap.createBitmap(inputSize, inputSize, Bitmap.Config.ARGB_8888)
            letterboxBitmap = bmp
            letterboxCanvas = Canvas(bmp)

            val mean = ModelConfig.IMAGE_MEAN.toFloat()
            val std = ModelConfig.IMAGE_STD.toFloat()
            for (i in 0..255) normLut[i] = (i.toFloat() - mean) / std

            loggedSample = false
            isModelLoaded = true
            Log.i(TAG, "Model loaded successfully.")
            Result.success(Unit)

        } catch (e: Exception) {
            val errorMessage = "Failed to load model '$modelPath': ${e.message}"
            Log.e(TAG, errorMessage, e)
            releaseResources()
            try {
                AppLogger.logError(context, errorMessage, e)
            } catch (loggerError: Exception) {
                Log.e(TAG, "Failed to write error to AppLogger", loggerError)
            }
            Result.failure(e)
        }
    }

    /**
     * Run inference on a Bitmap.
     *
     * @return null if inference could not run (not loaded, recycled bitmap, exception);
     *         otherwise the detections (possibly empty). AccidentEngine treats null as
     *         "YOLO skipped this frame" and an empty list as "YOLO ran, found nothing".
     */
    @Synchronized
    fun runInference(bitmap: Bitmap): List<Detection>? {
        val tflite = interpreter ?: return null
        if (!isModelLoaded || bitmap.isRecycled) return null

        val inBuf = inputBuffer ?: return null
        val inFloats = inputFloats ?: return null
        val outBuf = outputBuffer ?: return null
        val outFloats = outputFloats ?: return null
        val lbBitmap = letterboxBitmap ?: return null
        val canvas = letterboxCanvas ?: return null

        return try {
            val origWidth = bitmap.width
            val origHeight = bitmap.height
            val size = inputSize

            // ---- Letterbox (aspect-preserving, grey padding, like ultralytics) ----
            val scale = min(size.toFloat() / origWidth, size.toFloat() / origHeight)
            val scaledWidth = min(size, max(1, (origWidth * scale).roundToInt()))
            val scaledHeight = min(size, max(1, (origHeight * scale).roundToInt()))
            val padLeft = (size - scaledWidth) / 2
            val padTop = (size - scaledHeight) / 2

            canvas.drawColor(Color.rgb(PAD_VALUE, PAD_VALUE, PAD_VALUE))
            dstRect.set(padLeft, padTop, padLeft + scaledWidth, padTop + scaledHeight)
            canvas.drawBitmap(bitmap, null, dstRect, paint)

            // ---- Bitmap -> normalised float input (RGB) ----
            lbBitmap.getPixels(pixels, 0, size, 0, 0, size, size)
            val plane = size * size
            if (isNchwInput) {
                for (i in 0 until plane) {
                    val p = pixels[i]
                    inFloats.put(i, normLut[(p shr 16) and 0xFF])
                    inFloats.put(plane + i, normLut[(p shr 8) and 0xFF])
                    inFloats.put(2 * plane + i, normLut[p and 0xFF])
                }
            } else {
                var o = 0
                for (i in 0 until plane) {
                    val p = pixels[i]
                    inFloats.put(o++, normLut[(p shr 16) and 0xFF])
                    inFloats.put(o++, normLut[(p shr 8) and 0xFF])
                    inFloats.put(o++, normLut[p and 0xFF])
                }
            }

            // ---- Inference ----
            val startTime = SystemClock.uptimeMillis()
            inBuf.rewind()
            outBuf.rewind()
            tflite.run(inBuf, outBuf)
            outFloats.rewind()
            outFloats.get(outputArray)
            val inferenceTime = SystemClock.uptimeMillis() - startTime

            if (!loggedSample && outputArray.size >= 12) {
                loggedSample = true
                Log.d(TAG, "Raw output sample: " +
                        outputArray.sliceArray(0..11).joinToString(", ") { "%.4f".format(it) })
            }

            // ---- Decode ----
            val detections = decode(
                outputArray,
                origWidth, origHeight,
                scaledWidth.toFloat() / origWidth, scaledHeight.toFloat() / origHeight,
                padLeft.toFloat(), padTop.toFloat(),
                ModelConfig.CONFIDENCE_THRESHOLD
            )

            Log.d(TAG, "Inference ${inferenceTime} ms, detections=${detections.size}")
            detections

        } catch (e: Exception) {
            Log.e(TAG, "Inference failed: ${e.message}", e)
            null
        }
    }

    /**
     * Turn the raw output tensor into detections in original-image pixels.
     */
    private fun decode(
        out: FloatArray,
        origWidth: Int,
        origHeight: Int,
        scaleX: Float,
        scaleY: Float,
        padLeft: Float,
        padTop: Float,
        threshold: Float
    ): List<Detection> {
        // Each candidate: [a, b, c, d, score, cls]
        val raw = ArrayList<FloatArray>()

        when (layout) {
            OutputLayout.END2END -> {
                for (i in 0 until outDim1) {
                    val o = i * 6
                    val score = out[o + 4]
                    if (score < threshold) continue
                    raw.add(floatArrayOf(out[o], out[o + 1], out[o + 2], out[o + 3], score, out[o + 5]))
                }
            }
            OutputLayout.CHANNEL_MAJOR -> {
                // out[feature * A + anchor]; features = cx, cy, w, h, class scores (no objectness)
                val anchors = outDim2
                val classCount = outDim1 - 4
                for (a in 0 until anchors) {
                    var best = -1
                    var bestScore = 0f
                    for (c in 0 until classCount) {
                        val v = out[(4 + c) * anchors + a]
                        if (v > bestScore) { bestScore = v; best = c }
                    }
                    if (best < 0 || bestScore < threshold) continue
                    raw.add(
                        floatArrayOf(
                            out[a], out[anchors + a], out[2 * anchors + a], out[3 * anchors + a],
                            bestScore, best.toFloat()
                        )
                    )
                }
            }
            OutputLayout.ANCHOR_MAJOR -> {
                val anchors = outDim1
                val features = outDim2
                val hasObjectness = features == 85
                val classStart = if (hasObjectness) 5 else 4
                for (a in 0 until anchors) {
                    val base = a * features
                    val obj = if (hasObjectness) out[base + 4] else 1f
                    if (obj < threshold) continue
                    var best = -1
                    var bestScore = 0f
                    for (c in classStart until features) {
                        val v = out[base + c]
                        if (v > bestScore) { bestScore = v; best = c - classStart }
                    }
                    val score = obj * bestScore
                    if (best < 0 || score < threshold) continue
                    raw.add(
                        floatArrayOf(
                            out[base], out[base + 1], out[base + 2], out[base + 3],
                            score, best.toFloat()
                        )
                    )
                }
            }
        }

        if (raw.isEmpty()) return emptyList()

        // Boxes are either normalised (0..1 of model input) or already in model-input pixels.
        var maxCoord = 0f
        for (r in raw) for (k in 0..3) maxCoord = max(maxCoord, r[k])
        val mul = if (maxCoord <= 1.5f) inputSize.toFloat() else 1f
        val xyxy = layout == OutputLayout.END2END && END2END_XYXY

        var boxes = ArrayList<Box>(raw.size)
        for (r in raw) {
            val a = r[0] * mul
            val b = r[1] * mul
            val c = r[2] * mul
            val d = r[3] * mul
            boxes.add(
                if (xyxy) Box(a, b, c, d, r[4], r[5].toInt())
                else Box(a - c / 2f, b - d / 2f, a + c / 2f, b + d / 2f, r[4], r[5].toInt())
            )
        }

        val kept: List<Box> =
            if (layout == OutputLayout.END2END) boxes.sortedByDescending { it.score }.take(MAX_DET)
            else nms(boxes)

        val result = ArrayList<Detection>(kept.size)
        for (bx in kept) {
            // Undo letterbox, clip to image (ultralytics truncates to int).
            val x1 = ((bx.x1 - padLeft) / scaleX).coerceIn(0f, origWidth.toFloat()).toInt()
            val y1 = ((bx.y1 - padTop) / scaleY).coerceIn(0f, origHeight.toFloat()).toInt()
            val x2 = ((bx.x2 - padLeft) / scaleX).coerceIn(0f, origWidth.toFloat()).toInt()
            val y2 = ((bx.y2 - padTop) / scaleY).coerceIn(0f, origHeight.toFloat()).toInt()
            if (x2 <= x1 || y2 <= y1) continue

            val className = ModelConfig.CLASS_NAMES.getOrNull(bx.cls) ?: "cls_${bx.cls}"
            result.add(
                Detection(
                    Rect(x1, y1, x2, y2),
                    (x1 + x2) / 2f,
                    (y1 + y2) / 2f,
                    className,
                    bx.score
                )
            )
        }
        return result
    }

    /** Greedy class-aware NMS (raw YOLO outputs only). */
    private fun nms(boxes: List<Box>): List<Box> {
        val sorted = boxes.sortedByDescending { it.score }.take(1000)
        val kept = ArrayList<Box>()
        for (b in sorted) {
            var keep = true
            for (k in kept) {
                if (k.cls == b.cls && iou(k, b) > NMS_IOU) { keep = false; break }
            }
            if (keep) {
                kept.add(b)
                if (kept.size >= MAX_DET) break
            }
        }
        return kept
    }

    private fun iou(a: Box, b: Box): Float {
        val iw = min(a.x2, b.x2) - max(a.x1, b.x1)
        val ih = min(a.y2, b.y2) - max(a.y1, b.y1)
        if (iw <= 0f || ih <= 0f) return 0f
        val inter = iw * ih
        val areaA = max(0f, a.x2 - a.x1) * max(0f, a.y2 - a.y1)
        val areaB = max(0f, b.x2 - b.x1) * max(0f, b.y2 - b.y1)
        return inter / max(1e-6f, areaA + areaB - inter)
    }

    /**
     * Check whether the model is loaded.
     */
    @Synchronized
    fun isLoaded(): Boolean = isModelLoaded && interpreter != null

    /**
     * Release TensorFlow Lite resources.
     */
    @Synchronized
    fun close() {
        releaseResources()
        Log.d(TAG, "Interpreter closed.")
    }

    private fun releaseResources() {
        isModelLoaded = false
        try {
            interpreter?.close()
        } catch (e: Exception) {
            Log.e(TAG, "Error closing interpreter", e)
        }
        interpreter = null
        letterboxCanvas = null
        letterboxBitmap?.let { if (!it.isRecycled) it.recycle() }
        letterboxBitmap = null
        inputBuffer = null
        inputFloats = null
        outputBuffer = null
        outputFloats = null
        outputArray = FloatArray(0)
        pixels = IntArray(0)
    }
}
