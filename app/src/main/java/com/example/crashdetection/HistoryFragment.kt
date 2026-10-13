package com.example.crashdetection

import android.content.Context
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.example.crashdetection.databinding.FragmentHistoryBinding
import com.accident.AccidentResult
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

/** Local event history. This is persisted so changing tabs/recreating the view won't erase it. */
class HistoryFragment : Fragment() {
    private var _binding: FragmentHistoryBinding? = null
    private val binding get() = _binding
    private val adapter = HistoryAdapter()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentHistoryBinding.inflate(inflater, container, false)
        return _binding?.root ?: FrameLayout(inflater.context)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val ctx = context ?: return
        binding?.historyRecyclerView?.layoutManager = LinearLayoutManager(ctx)
        binding?.historyRecyclerView?.adapter = adapter
        val saved = loadEvents(ctx)
        adapter.submitList(saved)
        updateEmptyState(saved.isNotEmpty())
    }

    /** Records a model detection without mislabelling it as an accident. */
    fun addModelDetection(confidence: Float, labels: String, context: Context? = null) {
        addEvent(
            HistoryItem(
                timestamp = System.currentTimeMillis(),
                title = "MODEL DETECTION · ${"%.1f".format(confidence * 100f)}% confidence",
                details = "$labels · Detection only, not a confirmed accident"
            ),
            overrideContext = context
        )
    }

    fun addAccidentEvent(result: AccidentResult, confidence: Float? = null, context: Context? = null) {
        val type = if (result.hasCollision) "COLLISION" else if (result.hasRollover) "ROLLOVER" else "ACCIDENT EVENT"
        val confidenceText = confidence?.let { " · ${"%.1f".format(it * 100f)}% model confidence" } ?: ""
        addEvent(
            HistoryItem(
                timestamp = System.currentTimeMillis(),
                title = "$type DETECTED$confidenceText",
                details = "Gate: ${result.gateResult} · Tracks: ${result.tracks.size}"
            ),
            overrideContext = context
        )
    }

    private fun addEvent(item: HistoryItem, overrideContext: Context? = null) {
        val ctx = this.context?.applicationContext ?: overrideContext?.applicationContext ?: return
        val updated = (loadEvents(ctx) + item).sortedByDescending { it.timestamp }.take(250)
        saveEvents(ctx, updated)
        if (isAdded && _binding != null) {
            adapter.submitList(updated)
            updateEmptyState(updated.isEmpty())
        }
    }

    private fun updateEmptyState(isEmpty: Boolean = adapter.currentList.isEmpty()) {
        binding?.emptyHistoryText?.visibility = if (isEmpty) View.VISIBLE else View.GONE
        binding?.historyRecyclerView?.visibility = if (isEmpty) View.GONE else View.VISIBLE
    }

    private fun saveEvents(context: Context, events: List<HistoryItem>) {
        val array = JSONArray()
        events.forEach { event ->
            array.put(JSONObject().put("timestamp", event.timestamp).put("title", event.title).put("details", event.details))
        }
        context.getSharedPreferences("crash_detection_history", 0).edit()
            .putString("events", array.toString()).apply()
    }

    private fun loadEvents(context: Context? = this.context?.applicationContext): List<HistoryItem> {
        val ctx = context ?: return emptyList()
        val raw = ctx.getSharedPreferences("crash_detection_history", 0).getString("events", null) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            (0 until array.length()).map { i ->
                val obj = array.getJSONObject(i)
                HistoryItem(obj.getLong("timestamp"), obj.getString("title"), obj.getString("details"))
            }.sortedByDescending { it.timestamp }
        } catch (_: Exception) {
            emptyList()
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    data class HistoryItem(val timestamp: Long, val title: String, val details: String)
}

class HistoryAdapter : androidx.recyclerview.widget.ListAdapter<HistoryFragment.HistoryItem, HistoryAdapter.ViewHolder>(
    object : androidx.recyclerview.widget.DiffUtil.ItemCallback<HistoryFragment.HistoryItem>() {
        override fun areItemsTheSame(oldItem: HistoryFragment.HistoryItem, newItem: HistoryFragment.HistoryItem) =
            oldItem.timestamp == newItem.timestamp && oldItem.title == newItem.title
        override fun areContentsTheSame(oldItem: HistoryFragment.HistoryItem, newItem: HistoryFragment.HistoryItem) = oldItem == newItem
    }
) {
    class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val timeText: TextView = view.findViewById(android.R.id.text1)
        val detailText: TextView = view.findViewById(android.R.id.text2)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(android.R.layout.simple_list_item_2, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val item = getItem(position)
        holder.timeText.text = "${DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.MEDIUM).format(Date(item.timestamp))} · ${item.title}"
        holder.detailText.text = item.details
    }
}
