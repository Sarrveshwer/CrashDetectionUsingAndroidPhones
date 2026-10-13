package com.example.crashdetection

import android.Manifest
import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.MediaMetadataRetriever
import android.media.MediaExtractor
import android.media.MediaMuxer
import android.media.MediaFormat
import android.media.MediaCodec
import android.location.Location
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.result.ActivityResultLauncher
import kotlinx.coroutines.Dispatchers
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.viewpager2.widget.ViewPager2
import com.accident.AccidentEngine
import com.accident.AccidentResult
import com.accident.GateResult
import com.accident.Detection
import com.example.crashdetection.databinding.ActivityLiveDetectionBinding
import com.example.crashdetection.api.DeviceConnectionManager
import com.example.crashdetection.ml.ModelConfig
import com.example.crashdetection.ml.TFLiteInferenceManager
import com.google.android.material.tabs.TabLayoutMediator
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import android.util.Base64
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import org.opencv.android.Utils
import org.opencv.core.Mat
import java.util.Locale
import java.util.concurrent.Executors
import kotlinx.coroutines.isActive
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class LiveDetectionActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLiveDetectionBinding
    lateinit var inferenceManager: TFLiteInferenceManager
    lateinit var accidentEngine: AccidentEngine
    private val cameraExecutor = Executors.newSingleThreadExecutor()
    private var debugVideoJob: kotlinx.coroutines.Job? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var currentFrameIndex = 0
    @Volatile private var debugIncidentUploaded = false
    @Volatile private var debugAccidentRecorded = false
    @Volatile private var lastLiveIncidentUploadAtMs = 0L
    @Volatile private var lastHistoryDetectionAtMs = 0L
    private var currentDebugVideoUri: Uri? = null
    var currentCameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
    var currentModelName = ModelConfig.MODEL_PATH
    private var isModelLoaded = false
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private var lastLocation: Location? = null

    @SuppressLint("MissingPermission")
    private fun fetchLocation() {
        try {
            fusedLocationClient.lastLocation.addOnSuccessListener { location ->
                if (location != null) {
                    lastLocation = location
                    Log.i("LiveDetection", "Location acquired: ${location.latitude}, ${location.longitude}")
                }
            }
        } catch (e: Exception) {
            Log.w("LiveDetection", "Failed to get location", e)
        }
    }

    private val selectImageLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: android.net.Uri? ->
        uri?.let { selectImage(uri) }
    }

    private val selectVideoLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: android.net.Uri? ->
        uri?.let { startDebugVideo(uri) }
    }

    private val selectCalibrationVideoLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: android.net.Uri? ->
        uri?.let { startCalibrationVideo(uri) }
    }

    private val selectHomographyLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: android.net.Uri? ->
        uri?.let { loadHomography(uri) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        System.loadLibrary("opencv_java4")

        binding = ActivityLiveDetectionBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setSupportActionBar(binding.toolbar)

        setupViewPager()

        inferenceManager = TFLiteInferenceManager(this)
        accidentEngine = AccidentEngine("main", this, "adaptive")
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        fetchLocation()

        // The live-detection screen is the launcher activity, so connect from here.
        // Keep retrying after Wi-Fi/server restarts instead of requiring an app restart.
        lifecycleScope.launch(Dispatchers.IO) {
            var registered = false
            while (isActive) {
                if (!registered) {
                    registered = DeviceConnectionManager.register(this@LiveDetectionActivity).isSuccess
                    Log.i("DeviceConnection", if (registered) "Device registered" else "Registration pending; will retry")
                }
                if (registered) {
                    fetchLocation()
                    val heartbeat = DeviceConnectionManager.heartbeat(this@LiveDetectionActivity, lastLocation)
                    if (heartbeat.isFailure) {
                        Log.w("DeviceConnection", "Heartbeat failed; will retry registration", heartbeat.exceptionOrNull())
                        registered = false
                    }
                }
                delay(if (registered) 30_000L else 10_000L)
            }
        }

        requestPermissionLauncher.launch(
            arrayOf(
                Manifest.permission.CAMERA,
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            )
        )
    }

    override fun onResume() {
        super.onResume()
        // Load model after layout is complete and fragments are created
        if (!isModelLoaded) {
            loadModel(ModelConfig.MODEL_PATH)
        }
    }

    private fun setupViewPager() {
        val adapter = MainPagerAdapter(this)
        binding.viewPager.adapter = adapter
        TabLayoutMediator(binding.tabLayout, binding.viewPager) { tab, position ->
            tab.text = adapter.getPageTitle(position)
        }.attach()
    }

    fun getCameraFragment(): CameraFragment? {
        val adapter = binding.viewPager.adapter as? MainPagerAdapter
        return adapter?.getFragment(0) as? CameraFragment
    }

    fun getSettingsFragment(): SettingsFragment? {
        val adapter = binding.viewPager.adapter as? MainPagerAdapter
        return adapter?.getFragment(1) as? SettingsFragment
    }

    fun getHistoryFragment(): HistoryFragment? {
        val adapter = binding.viewPager.adapter as? MainPagerAdapter
        return adapter?.getFragment(2) as? HistoryFragment
    }

    fun loadModel(modelPath: String) {
        inferenceManager.close()
        val result = inferenceManager.loadModel(modelPath)
        currentModelName = modelPath
        if (result.isSuccess) {
            isModelLoaded = true
            getCameraFragment()?.updateModelStatus("Model: Loaded ($modelPath)")
            getSettingsFragment()?.updateConfigDisplay()
        } else {
            isModelLoaded = false
            getCameraFragment()?.updateModelStatus("Model: Failed to Load")
            Toast.makeText(this, "Model Load Failed", Toast.LENGTH_SHORT).show()
        }
    }

    private fun selectImage(uri: android.net.Uri) {
        stopDebugVideo()
        stopCamera()
        getCameraFragment()?.hideDebugFrame()
        val bitmap = try {
            val source = android.graphics.ImageDecoder.createSource(contentResolver, uri)
            android.graphics.ImageDecoder.decodeBitmap(source) { decoder, _, _ ->
                decoder.isMutableRequired = true
            }
        } catch (e: Exception) {
            Log.e("LiveDetection", "Error selecting image", e)
            null
        }
        if (bitmap != null) {
            currentFrameIndex++
            val detections = inferenceManager.runInference(bitmap)
            detections?.let { detections ->
                getCameraFragment()?.updateDetectionResults(bitmap, detections)
            }
        }
    }

    fun startDebugVideo(uri: android.net.Uri) {
        stopDebugVideo()
        stopCamera()
        currentDebugVideoUri = uri
        debugIncidentUploaded = false
        debugAccidentRecorded = false
        getCameraFragment()?.showDebugFrame(Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888))
        debugVideoJob = lifecycleScope.launch(Dispatchers.IO) {
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(this@LiveDetectionActivity, uri)
                val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    ?.toLongOrNull() ?: 0L
                val durationUs = durationMs * 1000L
                var frameTimeUs = 0L
                while (isActive && (durationUs <= 0L || frameTimeUs <= durationUs)) {
                    val bitmap = retriever.getFrameAtTime(frameTimeUs, MediaMetadataRetriever.OPTION_CLOSEST)
                        ?: break
                    val detections = inferenceManager.runInference(bitmap)
                    currentFrameIndex++
                    val accident = detections?.let { runAccidentEngine(bitmap, it, currentFrameIndex) }
                    withContext(Dispatchers.Main) {
                        getCameraFragment()?.showDebugFrame(bitmap)
                        detections?.let { found ->
                            getCameraFragment()?.updateDetectionResults(bitmap, found)
                            val now = System.currentTimeMillis()
                            if (found.isNotEmpty() && now - lastHistoryDetectionAtMs >= 3_000L) {
                                lastHistoryDetectionAtMs = now
                                val maxConfidence = found.maxOfOrNull { it.confidence } ?: 0f
                                val labels = found.take(3).joinToString(", ") { it.className }
                                getHistoryFragment()?.addModelDetection(maxConfidence, labels, this@LiveDetectionActivity)
                            }
                        }
                        if (accident?.hasCollision == true || accident?.hasRollover == true) {
                            getCameraFragment()?.updateModelStatus(
                                if (accident.hasCollision) "ACCIDENT DETECTED · uploading evidence…"
                                else "ROLLOVER DETECTED · uploading evidence…"
                            )
                            if (!debugAccidentRecorded) {
                                debugAccidentRecorded = true
                                getHistoryFragment()?.addAccidentEvent(accident, detections?.maxOfOrNull { it.confidence }, this@LiveDetectionActivity)
                            }
                        }
                    }
                    if (!debugIncidentUploaded && accident != null &&
                        (accident.hasCollision || accident.hasRollover)) {
                        // Claim this event before launching upload so adjacent frames cannot create duplicates.
                        debugIncidentUploaded = true
                        val evidenceBitmap = bitmap.copy(Bitmap.Config.ARGB_8888, false)
                        val incidentType = if (accident.hasRollover) "ROLLOVER" else "CRASH"
                        val eventTimeUs = frameTimeUs
                        lifecycleScope.launch(Dispatchers.IO) {
                            val result = uploadDebugIncident(uri, evidenceBitmap, detections.orEmpty(), incidentType, eventTimeUs, durationUs)
                            withContext(Dispatchers.Main) {
                                val message = result.fold(
                                    { "${incidentType} evidence uploaded to CrashDet" },
                                    { "${incidentType} detected; upload failed: ${it.message ?: "unknown error"}" }
                                )
                                getCameraFragment()?.updateModelStatus(message)
                                Toast.makeText(this@LiveDetectionActivity, message, Toast.LENGTH_LONG).show()
                            }
                            evidenceBitmap.recycle()
                        }
                    }
                    frameTimeUs += 500_000L // sample every 0.5 seconds; MediaMetadataRetriever expects microseconds.
                    delay(200)
                }
            } catch (e: Exception) {
                Log.e("LiveDetection", "Debug video error", e)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@LiveDetectionActivity, "Debug video error: ${e.message}", Toast.LENGTH_LONG).show()
                }
            } finally {
                retriever.release()
            }
        }
    }

    /** Runs the existing three-stage motion/trajectory classifier on the same frames as TFLite. */
    private fun runAccidentEngine(bitmap: Bitmap, detections: List<Detection>, frameIndex: Int): AccidentResult? {
        val mat = Mat()
        return try {
            Utils.bitmapToMat(bitmap, mat)
            accidentEngine.process(mat, detections, frameIndex)
        } catch (e: Exception) {
            Log.e("LiveDetection", "Accident engine failed on frame $frameIndex", e)
            null
        } finally {
            mat.release()
        }
    }

    private suspend fun uploadDebugIncident(
        sourceUri: Uri,
        snapshot: Bitmap,
        detections: List<Detection>,
        incidentType: String,
        eventTimeUs: Long,
        durationUs: Long
    ): Result<Unit> = runCatching {
        val deviceId = com.example.crashdetection.utils.DeviceUtils.getDeviceId(this)
        val snapshotBytes = ByteArrayOutputStream().use { out ->
            snapshot.compress(Bitmap.CompressFormat.JPEG, 82, out)
            out.toByteArray()
        }
        val snapshotBase64 = Base64.encodeToString(snapshotBytes, Base64.NO_WRAP)
        val vehicleCount = detections.count {
            it.className.lowercase(Locale.ROOT).let { name ->
                name.contains("car") || name.contains("truck") || name.contains("bus") ||
                    name.contains("motorcycle") || name.contains("motorbike") || name.contains("vehicle")
            }
        }
        val confidence = detections.maxOfOrNull { it.confidence } ?: 0f
        if (DeviceConnectionManager.getCameraId(this) == null) {
            DeviceConnectionManager.register(this)
        }
        val clip = createVideoClip(sourceUri, eventTimeUs, durationUs)
        try {
            fetchLocation()
            val report = com.example.crashdetection.models.IncidentReport(
                cameraId = DeviceConnectionManager.getCameraId(this),
                edgeDeviceId = deviceId,
                cameraName = DeviceConnectionManager.getCameraName(this),
                timestamp = System.currentTimeMillis(),
                latitude = lastLocation?.latitude,
                longitude = lastLocation?.longitude,
                confidence = confidence,
                snapshotImage = snapshotBase64,
                vehicleCount = vehicleCount,
                incidentType = incidentType
            )
            val videoPart = MultipartBody.Part.createFormData(
                "video", clip.name, clip.asRequestBody("video/mp4".toMediaType())
            )
            val response = com.example.crashdetection.api.RetrofitClient.service(this)
                .reportIncidentWithVideo(report, videoPart)
            if (!response.isSuccessful) {
                val errorBody = response.errorBody()?.string() ?: ""
                Log.e("LiveDetection", "Incident video upload failed (HTTP ${response.code()}): $errorBody")
            }
            check(response.isSuccessful) { "Incident upload failed (HTTP ${response.code()})" }
        } finally {
            clip.delete()
        }
    }

    /** Extract a playable MP4 segment spanning 5 seconds before and 10 seconds after the event. */
    private fun createVideoClip(sourceUri: Uri, eventTimeUs: Long, durationUs: Long): File {
        val extractor = MediaExtractor()
        val output = File(cacheDir, "crashdet_${System.currentTimeMillis()}.mp4")
        var muxer: MediaMuxer? = null
        try {
            extractor.setDataSource(this, sourceUri, null)
            val trackMap = HashMap<Int, Int>()
            for (i in 0 until extractor.trackCount) {
                val format = extractor.getTrackFormat(i)
                val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                if (mime.startsWith("video/") || mime.startsWith("audio/")) {
                    trackMap[i] = -1
                }
            }
            check(trackMap.keys.any { (extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME) ?: "").startsWith("video/") }) {
                "Selected file has no video track"
            }
            muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            trackMap.keys.toList().forEach { track ->
                trackMap[track] = muxer.addTrack(extractor.getTrackFormat(track))
                extractor.selectTrack(track)
            }
            val requestedStartUs = maxOf(0L, eventTimeUs - 5_000_000L)
            val endUs = if (durationUs > 0) minOf(durationUs, eventTimeUs + 10_000_000L) else eventTimeUs + 10_000_000L
            extractor.seekTo(requestedStartUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            val actualStartUs = extractor.sampleTime.coerceAtLeast(0L)
            muxer.start()
            val info = MediaCodec.BufferInfo()
            var wroteSamples = 0
            while (extractor.sampleTime >= 0 && extractor.sampleTime <= endUs) {
                val sourceTrack = extractor.sampleTrackIndex
                val targetTrack = trackMap[sourceTrack]
                val size = extractor.sampleSize
                if (targetTrack != null && size > 0 && extractor.sampleTime >= actualStartUs) {
                    val buffer = java.nio.ByteBuffer.allocate(size.toInt())
                    val read = extractor.readSampleData(buffer, 0)
                    if (read > 0) {
                        info.set(0, read, (extractor.sampleTime - actualStartUs).coerceAtLeast(0L), extractor.sampleFlags)
                        buffer.position(0)
                        buffer.limit(read)
                        muxer.writeSampleData(targetTrack, buffer, info)
                        wroteSamples++
                    }
                }
                if (!extractor.advance()) break
            }
            check(wroteSamples > 0) { "Could not extract an evidence clip from this video" }
            muxer.stop()
            muxer.release()
            muxer = null
            return output
        } catch (e: Exception) {
            output.delete()
            throw e
        } finally {
            try { muxer?.release() } catch (_: Exception) { }
            extractor.release()
        }
    }

    private suspend fun uploadSnapshotIncident(snapshot: Bitmap, detections: List<Detection>, incidentType: String) {
        val deviceId = com.example.crashdetection.utils.DeviceUtils.getDeviceId(this)
        val bytes = ByteArrayOutputStream().use { out ->
            snapshot.compress(Bitmap.CompressFormat.JPEG, 82, out)
            out.toByteArray()
        }
        if (DeviceConnectionManager.getCameraId(this) == null) {
            DeviceConnectionManager.register(this)
        }
        fetchLocation()
        val report = com.example.crashdetection.models.IncidentReport(
            cameraId = DeviceConnectionManager.getCameraId(this),
            edgeDeviceId = deviceId,
            cameraName = DeviceConnectionManager.getCameraName(this),
            timestamp = System.currentTimeMillis(),
            latitude = lastLocation?.latitude,
            longitude = lastLocation?.longitude,
            confidence = detections.maxOfOrNull { it.confidence } ?: 0f,
            snapshotImage = Base64.encodeToString(bytes, Base64.NO_WRAP),
            vehicleCount = detections.count { d ->
                d.className.lowercase(Locale.ROOT).let { it.contains("car") || it.contains("truck") || it.contains("bus") || it.contains("motorcycle") || it.contains("motorbike") || it.contains("vehicle") }
            },
            incidentType = incidentType
        )
        val response = com.example.crashdetection.api.RetrofitClient.service(this).reportIncident(report)
        if (!response.isSuccessful) {
            val errorBody = response.errorBody()?.string() ?:("")
            Log.e("LiveDetection", "Incident report failed (HTTP ${response.code()}): $errorBody")
        }
        check(response.isSuccessful) { "Incident report failed (HTTP ${response.code()})" }
    }

    private fun stopDebugVideo() {
        debugVideoJob?.cancel()
        getCameraFragment()?.hideDebugFrame()
    }

    private fun startCalibrationVideo(uri: android.net.Uri) {
        stopDebugVideo()
        stopCamera()
        getCameraFragment()?.showDebugFrame(Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888))
        getCameraFragment()?.updateModelStatus("Mode: CALIBRATION")
        val calibrationJob = lifecycleScope.launch(Dispatchers.IO) {
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(this@LiveDetectionActivity, uri)
                var frameIndex = 0L
                while (isActive) {
                    val bitmap = retriever.getFrameAtTime(frameIndex * 1000, MediaMetadataRetriever.OPTION_CLOSEST)
                    if (bitmap != null) {
                        withContext(Dispatchers.Main) {
                            getCameraFragment()?.showDebugFrame(bitmap)
                            currentFrameIndex++
                            val detections = inferenceManager.runInference(bitmap)
                            detections?.let { detections ->
                                if (!detections.isEmpty()) {
                                    getCameraFragment()?.updateModelStatus("Calibrating: ${detections.size} objects")
                                }
                            }
                        }
                    }
                    frameIndex += 1000000L
                    kotlinx.coroutines.delay(500)
                }
            } catch (e: Exception) {
                Log.e("LiveDetection", "Calibration video error", e)
            } finally {
                retriever.release()
                withContext(Dispatchers.Main) {
                    getCameraFragment()?.updateModelStatus("Calibration complete")
                }
            }
        }
    }

    fun loadHomography(uri: android.net.Uri) {
        try {
            val inputStream = contentResolver.openInputStream(uri)
            inputStream?.use { input ->
                val bytes = input.readBytes()
                val jsonText = String(bytes, java.nio.charset.StandardCharsets.UTF_8)
                val data = org.json.JSONObject(jsonText)
                val matrixArray = if (data.has("homography")) data.getJSONArray("homography") else data.getJSONArray("")
                if (matrixArray.length() == 9 || matrixArray.length() == 3) {
                    val H = org.opencv.core.Mat(3, 3, org.opencv.core.CvType.CV_64F)
                    var idx = 0
                    for (r in 0..2) {
                        for (c in 0..2) {
                            val value = if (matrixArray.length() == 9) matrixArray.getDouble(idx++) else matrixArray.getJSONArray(r).getDouble(c)
                            H.put(r, c, value)
                        }
                    }
                    accidentEngine.setHomography(H)
                    getCameraFragment()?.updateModelStatus("Homography loaded")
                    getSettingsFragment()?.updateConfigDisplay()
                    Toast.makeText(this, "Homography loaded successfully", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this, "Invalid homography format", Toast.LENGTH_SHORT).show()
                }
            }
        } catch (e: Exception) {
            Log.e("LiveDetection", "Failed to load homography", e)
            Toast.makeText(this, "Failed to load homography: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    fun loadModelFromUri(uri: android.net.Uri) {
        try {
            val inputStream = contentResolver.openInputStream(uri)
            inputStream?.use { input ->
                val bytes = input.readBytes()
                val tempFile = java.io.File(cacheDir, "temp_model.tflite")
                tempFile.writeBytes(bytes)
                loadModel(tempFile.absolutePath)
            }
        } catch (e: Exception) {
            Log.e("LiveDetection", "Failed to load model from URI", e)
            Toast.makeText(this, "Failed to load model: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    fun restartCamera() {
        if (cameraProvider != null) {
            startCamera()
        }
    }

    private fun startCamera() {
        stopDebugVideo()
        stopCamera()
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            cameraProvider = cameraProviderFuture.get()
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(getCameraFragment()?.binding?.previewView?.surfaceProvider)
            }

            val imageAnalysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also {
                    it.setAnalyzer(cameraExecutor) { imageProxy ->
                        Log.d("LiveDetection", "Analyzer called, image: ${imageProxy.imageInfo}")
                        val bitmap = imageProxyToBitmap(imageProxy)
                        Log.d("LiveDetection", "Bitmap created: ${bitmap != null}")
                        if (bitmap != null) {
                            currentFrameIndex++
                            val detections = inferenceManager.runInference(bitmap)
                            detections?.let { frameDetections ->
                                val accident = runAccidentEngine(bitmap, frameDetections, currentFrameIndex)
                                runOnUiThread {
                                    getCameraFragment()?.updateDetectionResults(bitmap, frameDetections)
                                    val now = System.currentTimeMillis()
                                    if (frameDetections.isNotEmpty() && now - lastHistoryDetectionAtMs >= 3_000L) {
                                        lastHistoryDetectionAtMs = now
                                        val maxConfidence = frameDetections.maxOfOrNull { it.confidence } ?: 0f
                                        val labels = frameDetections.take(3).joinToString(", ") { it.className }
                                        getHistoryFragment()?.addModelDetection(maxConfidence, labels, this@LiveDetectionActivity)
                                    }
                                    if (accident?.hasCollision == true || accident?.hasRollover == true) {
                                        getCameraFragment()?.updateModelStatus("Accident detected by live camera")
                                    }
                                }
                                val now = System.currentTimeMillis()
                                if (accident != null && (accident.hasCollision || accident.hasRollover) &&
                                    now - lastLiveIncidentUploadAtMs >= 60_000L) {
                                    lastLiveIncidentUploadAtMs = now
                                    val snap = bitmap.copy(Bitmap.Config.ARGB_8888, false)
                                    val type = if (accident.hasRollover) "ROLLOVER" else "CRASH"
                                    runOnUiThread {
                                        getHistoryFragment()?.addAccidentEvent(accident, frameDetections.maxOfOrNull { it.confidence }, this@LiveDetectionActivity)
                                    }
                                    lifecycleScope.launch(Dispatchers.IO) {
                                        try {
                                            uploadSnapshotIncident(snap, frameDetections, type)
                                            Log.i("LiveDetection", "Incident sent to backend: $type")
                                        } catch (e: Exception) {
                                            Log.e("LiveDetection", "Live incident upload failed", e)
                                            withContext(Dispatchers.Main) {
                                                Toast.makeText(this@LiveDetectionActivity, "Incident not sent to dashboard: ${e.message}", Toast.LENGTH_LONG).show()
                                            }
                                        } finally { snap.recycle() }
                                    }
                                }
                            }
                        }
                        imageProxy.close()
                    }
                }

            try {
                cameraProvider?.unbindAll()
                cameraProvider?.bindToLifecycle(this, currentCameraSelector, preview, imageAnalysis)
            } catch (e: Exception) {
                Log.e("LiveDetection", "Camera binding failed", e)
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun stopCamera() {
        cameraProvider?.unbindAll()
        cameraProvider = null
    }

    private fun imageProxyToBitmap(image: ImageProxy): Bitmap? {
        val yBuffer = image.planes[0].buffer
        val uBuffer = image.planes[1].buffer
        val vBuffer = image.planes[2].buffer
        val ySize = yBuffer.remaining()
        val uSize = uBuffer.remaining()
        val vSize = vBuffer.remaining()
        val nv21 = ByteArray(ySize + uSize + vSize)
        yBuffer.get(nv21, 0, ySize)
        vBuffer.get(nv21, ySize, vSize)
        uBuffer.get(nv21, ySize + vSize, uSize)
        val yuvImage = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
        val out = ByteArrayOutputStream()
        yuvImage.compressToJpeg(Rect(0, 0, image.width, image.height), 100, out)
        val imageBytes = out.toByteArray()
        return BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
    }

    override fun onDestroy() {
        super.onDestroy()
        stopDebugVideo()
        stopCamera()
        cameraExecutor.shutdown()
        inferenceManager.close()
        accidentEngine.release()
    }

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val cameraGranted = permissions[Manifest.permission.CAMERA] ?: false
        if (cameraGranted) {
            startCamera()
        } else {
            Toast.makeText(this, "Camera permission is required", Toast.LENGTH_SHORT).show()
        }
    }
}