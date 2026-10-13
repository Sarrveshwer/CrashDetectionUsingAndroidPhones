package com.example.crashdetection

import android.graphics.Bitmap
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.camera.core.ImageProxy
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.accident.Detection
import com.example.crashdetection.databinding.FragmentCameraBinding
import com.example.crashdetection.ml.TFLiteInferenceManager
import kotlinx.coroutines.launch

class CameraFragment : Fragment() {

    private var _binding: FragmentCameraBinding? = null
    val binding get() = _binding
    private var inferenceManager: TFLiteInferenceManager? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentCameraBinding.inflate(inflater, container, false)
        return _binding?.root ?: FrameLayout(requireContext())
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        inferenceManager = (activity as? LiveDetectionActivity)?.inferenceManager
    }

    fun updateDetectionResults(bitmap: Bitmap?, detections: List<Detection>?) {
        detections?.let { dets ->
            binding?.predictionText?.text = "Found ${dets.size} objects"
            val maxConf = dets.maxByOrNull { it.confidence }?.confidence ?: 0f
            binding?.confidenceText?.text = String.format("Max confidence: %.1f%%", maxConf * 100)
        }
    }

    fun updateModelStatus(status: String) {
        binding?.modelStatusText?.text = status
    }

    fun showDebugFrame(bitmap: Bitmap) {
        binding?.debugVideoFrameView?.visibility = View.VISIBLE
        binding?.debugVideoFrameView?.setImageBitmap(bitmap)
    }

    fun hideDebugFrame() {
        binding?.debugVideoFrameView?.visibility = View.GONE
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}