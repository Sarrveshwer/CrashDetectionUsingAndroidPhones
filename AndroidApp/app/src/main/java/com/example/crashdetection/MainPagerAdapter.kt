package com.example.crashdetection

import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import androidx.viewpager2.adapter.FragmentStateAdapter

class MainPagerAdapter(activity: FragmentActivity) : FragmentStateAdapter(activity) {

    private val fragments = arrayOf(
        CameraFragment(),
        SettingsFragment(),
        HistoryFragment(),
        AboutFragment()
    )

    private val titles = arrayOf("Camera", "Settings", "History", "About")

    override fun getItemCount(): Int = fragments.size

    override fun createFragment(position: Int): Fragment = fragments[position]

    fun getPageTitle(position: Int): String = titles[position]

    fun getFragment(position: Int): Fragment = fragments[position]
}