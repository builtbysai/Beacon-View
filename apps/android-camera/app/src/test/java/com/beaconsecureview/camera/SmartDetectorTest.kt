package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals

class SmartDetectorTest {
    /** Locks in ADR 0075's product decision -- a deliberately short,
     * security-camera-relevant subset of EfficientDet-Lite0's COCO categories,
     * not every category the model can name. A change here should come with a
     * reason recorded in the ADR, not an accidental drift. */
    @Test
    fun allowedLabelsMatchTheRecordedProductDecision() {
        assertEquals(
            listOf("person", "car", "bicycle", "dog", "cat"),
            SmartDetector.ALLOWED_LABELS,
        )
    }
}
