package com.beaconsecureview.camera

/**
 * One detected category and its confidence (ADR 0074/0075). Never a name, face, or
 * biometric template -- ADR 0031's ban on facial recognition is not revisable here.
 */
internal data class SmartDetection(val label: String, val confidence: Float)
