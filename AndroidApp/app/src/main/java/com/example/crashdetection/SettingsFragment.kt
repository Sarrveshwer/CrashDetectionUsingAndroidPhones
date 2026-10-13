package com.example.crashdetection

import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.Toast
import android.widget.EditText
import android.text.InputType
import android.widget.LinearLayout
import com.example.crashdetection.api.ServerConfig
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.example.crashdetection.api.DeviceConnectionManager
import com.example.crashdetection.databinding.FragmentSettingsBinding
import com.example.crashdetection.ml.ModelConfig
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.launch

class SettingsFragment : Fragment() {

    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding

    private val selectModelLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { (activity as? LiveDetectionActivity)?.loadModelFromUri(it) }
    }

    private val selectCalibrationLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { (activity as? LiveDetectionActivity)?.loadHomography(it) }
    }

    private val selectDebugVideoLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { (activity as? LiveDetectionActivity)?.startDebugVideo(it) }
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return _binding?.root ?: FrameLayout(requireContext())
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupClickListeners()
        addServerConnectionControl()
        updateConfigDisplay()
    }


    private fun addServerConnectionControl() {
        val scroll = view as? android.view.ViewGroup ?: return
        val content = scroll.getChildAt(0) as? LinearLayout ?: return
        val button = com.google.android.material.button.MaterialButton(requireContext()).apply {
            text = "Configure Node.js Server"
            isAllCaps = false
            setOnClickListener {
                val input = EditText(requireContext()).apply {
                    hint = "http://192.168.1.10:5000"
                    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
                    setSingleLine(true)
                    setText(ServerConfig.baseUrl(requireContext()).removeSuffix("api/"))
                }
                com.google.android.material.dialog.MaterialAlertDialogBuilder(requireContext())
                    .setTitle("Backend server address")
                    .setMessage("Use the computer's LAN IP when this is a physical phone. Emulator default is 10.0.2.2:5000.")
                    .setView(input)
                    .setNegativeButton("Cancel", null)
                    .setPositiveButton("Save & reconnect") { _, _ ->
                        try {
                            ServerConfig.saveBaseUrl(requireContext(), input.text.toString())
                            Toast.makeText(requireContext(), "Server saved. Auto-reconnect will retry shortly.", Toast.LENGTH_LONG).show()
                        } catch (e: Exception) {
                            Toast.makeText(requireContext(), e.message ?: "Invalid server URL", Toast.LENGTH_LONG).show()
                        }
                    }
                    .show()
            }
        }
        content.addView(button, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = 12 })
    }

    private fun setupClickListeners() {
        binding?.selectModelButton?.setOnClickListener {
            val models = activity?.assets?.list("")?.filter { it.endsWith(".tflite") } ?: emptyList()
            if (models.isEmpty()) {
                Toast.makeText(requireContext(), "No .tflite models found in assets", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            MaterialAlertDialogBuilder(requireContext())
                .setTitle("Select TFLite Model")
                .setItems(models.toTypedArray()) { _, which ->
                    (activity as? LiveDetectionActivity)?.loadModel(models[which])
                    updateConfigDisplay()
                }
                .show()
        }

        binding?.selectCameraButton?.setOnClickListener {
            val cameras = arrayOf("Back Camera", "Front Camera")
            val currentIdx = if ((activity as? LiveDetectionActivity)?.currentCameraSelector ==
                androidx.camera.core.CameraSelector.DEFAULT_BACK_CAMERA) 0 else 1
            MaterialAlertDialogBuilder(requireContext())
                .setTitle("Select Camera")
                .setSingleChoiceItems(cameras, currentIdx) { _, which ->
                    (activity as? LiveDetectionActivity)?.apply {
                        currentCameraSelector = if (which == 0)
                            androidx.camera.core.CameraSelector.DEFAULT_BACK_CAMERA
                        else
                            androidx.camera.core.CameraSelector.DEFAULT_FRONT_CAMERA
                        restartCamera()
                    }
                    updateConfigDisplay()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }

        binding?.selectCalibrationButton?.setOnClickListener {
            selectCalibrationLauncher.launch("video/*")
        }

        binding?.selectDebugVideoButton?.setOnClickListener {
            selectDebugVideoLauncher.launch("video/*")
        }

        binding?.confidenceSlider?.addOnChangeListener { slider, value, fromUser ->
            if (fromUser) {
                com.example.crashdetection.ml.ModelConfig.CONFIDENCE_THRESHOLD = value
                Log.d("Settings", "Confidence threshold: $value")
            }
        }

        binding?.iouSlider?.addOnChangeListener { slider, value, fromUser ->
            if (fromUser) {
                com.example.crashdetection.ml.ModelConfig.IOU_THRESHOLD = value
                Log.d("Settings", "IoU threshold: $value")
            }
        }

        binding?.saveCameraNameButton?.setOnClickListener {
            val name = binding?.cameraNameEditText?.text?.toString()?.trim()
            if (!name.isNullOrBlank()) {
                lifecycleScope.launch {
                    val result = DeviceConnectionManager.updateCameraName(requireContext(), name)
                    if (result.isSuccess) {
                        Toast.makeText(requireContext(), "Camera name saved and synced!", Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(requireContext(), "Saved locally, sync failed: ${result.exceptionOrNull()?.message}", Toast.LENGTH_LONG).show()
                    }
                    updateConfigDisplay()
                }
            } else {
                Toast.makeText(requireContext(), "Please enter a valid camera name", Toast.LENGTH_SHORT).show()
            }
        }
    }

    fun updateConfigDisplay() {
        val activity = activity as? LiveDetectionActivity
        activity?.let {
            binding?.currentModelText?.text = "Model: ${it.currentModelName}"
            binding?.currentCameraText?.text = "Camera: ${if (it.currentCameraSelector == androidx.camera.core.CameraSelector.DEFAULT_BACK_CAMERA) "Back" else "Front"}"
            binding?.calibrationStatusText?.text = "Calibration: ${if (it.accidentEngine?.isCalibrated == true) "Loaded" else "Not loaded"}"
        }
        binding?.confidenceSlider?.value = com.example.crashdetection.ml.ModelConfig.CONFIDENCE_THRESHOLD
        binding?.iouSlider?.value = ModelConfig.IOU_THRESHOLD
        binding?.cameraNameEditText?.setText(DeviceConnectionManager.getCameraName(requireContext()))
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}