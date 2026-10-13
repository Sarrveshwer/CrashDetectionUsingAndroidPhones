package com.example.crashdetection.ml

object ModelConfig {

    /**
     * TFLite model stored in:
     *
     * app/src/main/assets/
     */
    const val MODEL_PATH = "yolo26n.tflite"

    /**
     * Model input shape for YOLO:
     *
     * [1, 640, 640, 3]
     */
    const val INPUT_SIZE = 640

    /**
     * FLOAT32 preprocessing.
     *
     * Converts RGB values from:
     *
     * 0..255
     *
     * to:
     *
     * 0..1
     */
    const val IMAGE_MEAN = 0.0f
    const val IMAGE_STD = 255.0f

    var CONFIDENCE_THRESHOLD = 0.05f
    var IOU_THRESHOLD = 0.45f

    /**
     * COCO class names for YOLO model.
     * The order MUST match the order used when
     * the model was trained.
     */
    val CLASS_NAMES = arrayOf(
        "person", "bicycle", "car", "motorcycle",
        "airplane", "bus", "train", "truck",
        "boat", "traffic light", "fire hydrant",
        "stop sign", "parking meter", "bench",
        "bird", "cat", "dog", "horse",
        "sheep", "cow", "elephant", "bear",
        "zebra", "giraffe", "backpack",
        "umbrella", "handbag", "tie",
        "suitcase", "frisbee", "skis",
        "snowboard", "sports ball",
        "kite", "baseball bat", "baseball glove",
        "skateboard", "surfboard", "tennis racket",
        "bottle", "wine glass", "cup",
        "fork", "knife", "spoon",
        "bowl", "banana", "apple",
        "sandwich", "orange", "broccoli",
        "carrot", "hot dog", "pizza",
        "donut", "cake", "chair",
        "couch", "potted plant", "bed",
        "dining table", "toilet", "tv",
        "laptop", "mouse", "remote",
        "keyboard", "cell phone",
        "microwave", "oven", "toaster",
        "sink", "refrigerator", "book",
        "clock", "vase", "scissors",
        "teddy bear", "hair drier",
        "toothbrush"
    )
}
