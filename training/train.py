#!/usr/bin/env python3
"""
Train a MobileNet v3 Small classifier for AS 1319 safety sign categories.

Architecture:
  - Base: MobileNet v3 Small (ImageNet weights, frozen)
  - Head: GlobalAveragePooling2D → Dense(128, ReLU) → Dropout(0.3) → Dense(7, softmax)

The model classifies images into 7 AS 1319 categories:
  0: prohibition, 1: mandatory, 2: restriction,
  3: warning, 4: danger, 5: emergency, 6: fire

Usage:
    python train.py --data ./dataset --epochs 25 --batch 32
    python train.py --data ./dataset --epochs 25 --unfreeze 10  # fine-tune top N layers
"""

import argparse
import os
import json
import numpy as np
from pathlib import Path

import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, callbacks
from sklearn.metrics import classification_report, confusion_matrix
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


# AS 1319 categories — order must match AS1319_CATEGORIES in ml-loader.js
CATEGORIES = [
    'prohibition',   # 0
    'mandatory',     # 1
    'restriction',   # 2
    'warning',       # 3
    'danger',        # 4
    'emergency',     # 5
    'fire',          # 6
]

IMG_SIZE = 224
AUTOTUNE = tf.data.AUTOTUNE


def create_datasets(data_dir: Path, batch_size: int, val_split: float = 0.1, test_split: float = 0.1):
    """
    Create train/val/test datasets from the organised directory structure.
    Expects: data_dir/{category_name}/*.jpg
    """
    # Verify all category folders exist
    for cat in CATEGORIES:
        cat_dir = data_dir / cat
        if not cat_dir.exists():
            print(f"Warning: Category folder '{cat}' not found. Creating empty placeholder.")
            cat_dir.mkdir(parents=True, exist_ok=True)

    # Use keras utility to split from directory
    train_ds = keras.utils.image_dataset_from_directory(
        data_dir,
        class_names=CATEGORIES,
        label_mode='int',
        image_size=(IMG_SIZE, IMG_SIZE),
        batch_size=batch_size,
        validation_split=val_split + test_split,
        subset='training',
        seed=42,
    )

    val_test_ds = keras.utils.image_dataset_from_directory(
        data_dir,
        class_names=CATEGORIES,
        label_mode='int',
        image_size=(IMG_SIZE, IMG_SIZE),
        batch_size=batch_size,
        validation_split=val_split + test_split,
        subset='validation',
        seed=42,
    )

    # Split val_test into val and test
    val_size = int(len(val_test_ds) * (val_split / (val_split + test_split)))
    val_ds = val_test_ds.take(val_size)
    test_ds = val_test_ds.skip(val_size)

    return train_ds, val_ds, test_ds


def build_augmentation_layer():
    """Data augmentation pipeline simulating degraded real-world sign conditions."""
    return keras.Sequential([
        layers.RandomRotation(0.08),           # ±29 degrees
        layers.RandomZoom((-0.1, 0.1)),        # ±10% zoom
        layers.RandomTranslation(0.05, 0.05),  # ±5% shift
        layers.RandomBrightness(0.2),          # ±20% brightness
        layers.RandomContrast(0.2),            # ±20% contrast
        layers.RandomFlip('horizontal'),       # Signs can be mirrored in photos
    ], name='augmentation')


def synthesise_danger_signs(data_dir: Path, count: int = 500):
    """
    Synthesise DANGER sign images (red oval + white text on black background).
    AS 1319 DANGER signs are word-only — no dataset has them, so we generate them.
    """
    danger_dir = data_dir / 'danger'
    danger_dir.mkdir(parents=True, exist_ok=True)

    existing = list(danger_dir.glob('*.png')) + list(danger_dir.glob('*.jpg'))
    if len(existing) >= count:
        print(f"Danger category already has {len(existing)} images, skipping synthesis.")
        return

    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print("Warning: Pillow not installed. Cannot synthesise DANGER signs.")
        print("Install with: pip install Pillow")
        return

    print(f"Synthesising {count} DANGER sign images...")

    for i in range(count):
        # Randomise parameters for variation
        w, h = 224, 224
        bg_noise = np.random.randint(0, 30)
        rotation = np.random.uniform(-8, 8)
        brightness = np.random.uniform(0.7, 1.3)

        # Black background with noise
        img = Image.new('RGB', (w, h), (bg_noise, bg_noise, bg_noise))
        draw = ImageDraw.Draw(img)

        # Red oval (DANGER panel)
        oval_x1 = int(w * 0.1 + np.random.uniform(-5, 5))
        oval_y1 = int(h * 0.25 + np.random.uniform(-5, 5))
        oval_x2 = int(w * 0.9 + np.random.uniform(-5, 5))
        oval_y2 = int(h * 0.55 + np.random.uniform(-5, 5))
        red = (204 + np.random.randint(-20, 20), np.random.randint(0, 30), np.random.randint(0, 30))
        draw.ellipse([oval_x1, oval_y1, oval_x2, oval_y2], fill=red)

        # White "DANGER" text inside oval
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                                       int(28 + np.random.uniform(-4, 4)))
        except (OSError, IOError):
            font = ImageFont.load_default()

        text = "DANGER"
        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        tx = (w - tw) // 2 + int(np.random.uniform(-3, 3))
        ty = (oval_y1 + oval_y2 - th) // 2 + int(np.random.uniform(-3, 3))
        draw.text((tx, ty), text, fill=(255, 255, 255), font=font)

        # White message rectangle below
        rect_y1 = int(h * 0.58 + np.random.uniform(-3, 3))
        rect_y2 = int(h * 0.88 + np.random.uniform(-3, 3))
        draw.rectangle([oval_x1, rect_y1, oval_x2, rect_y2],
                       fill=(255, 255, 255), outline=(0, 0, 0), width=2)

        # Random hazard text in message area
        hazard_texts = [
            "HIGH VOLTAGE", "CONFINED SPACE", "HAZARDOUS AREA",
            "DO NOT ENTER", "KEEP OUT", "AUTHORISED PERSONNEL ONLY",
            "TOXIC CHEMICALS", "MOVING MACHINERY", "FALL HAZARD",
        ]
        msg = np.random.choice(hazard_texts)
        try:
            msg_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                                           int(14 + np.random.uniform(-2, 2)))
        except (OSError, IOError):
            msg_font = ImageFont.load_default()
        mbbox = draw.textbbox((0, 0), msg, font=msg_font)
        mw = mbbox[2] - mbbox[0]
        mx = (w - mw) // 2
        my = (rect_y1 + rect_y2) // 2 - (mbbox[3] - mbbox[1]) // 2
        draw.text((mx, my), msg, fill=(0, 0, 0), font=msg_font)

        # Apply rotation
        img = img.rotate(rotation, fillcolor=(bg_noise, bg_noise, bg_noise))

        # Apply brightness
        img_array = np.array(img, dtype=np.float32) * brightness
        img_array = np.clip(img_array, 0, 255).astype(np.uint8)
        img = Image.fromarray(img_array)

        img.save(danger_dir / f"synth_danger_{i:04d}.png")

    print(f"  Created {count} synthetic DANGER sign images.")


def synthesise_restriction_signs(data_dir: Path, count: int = 500):
    """
    Synthesise restriction sign images (red circle, white interior, black legend, NO diagonal bar).
    AS 1319 restriction signs look like prohibition signs minus the slash.
    We generate red-annulus circles with speed limit / weight limit style content.
    """
    restriction_dir = data_dir / 'restriction'
    restriction_dir.mkdir(parents=True, exist_ok=True)

    existing = list(restriction_dir.glob('*.png')) + list(restriction_dir.glob('*.jpg'))
    if len(existing) >= count:
        print(f"Restriction category already has {len(existing)} images, skipping synthesis.")
        return

    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print("Warning: Pillow not installed. Cannot synthesise restriction signs.")
        return

    print(f"Synthesising {count} restriction sign images...")

    restriction_texts = [
        "5", "10", "15", "20", "25", "30", "40", "50", "60", "80",
        "2t", "3t", "5t", "10t", "3.5m", "4.5m", "2.5m",
    ]

    for i in range(count):
        w, h = 224, 224
        rotation = np.random.uniform(-8, 8)
        brightness = np.random.uniform(0.7, 1.3)

        img = Image.new('RGB', (w, h), (240 + np.random.randint(-15, 15),) * 3)
        draw = ImageDraw.Draw(img)

        cx, cy = w // 2 + np.random.randint(-5, 5), h // 2 + np.random.randint(-5, 5)
        outer_r = int(90 + np.random.uniform(-10, 10))
        inner_r = int(outer_r * 0.8)

        # Red annulus (outer circle)
        red = (204 + np.random.randint(-20, 20), np.random.randint(0, 30), np.random.randint(0, 30))
        draw.ellipse([cx - outer_r, cy - outer_r, cx + outer_r, cy + outer_r], fill=red)
        # White interior
        draw.ellipse([cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r],
                      fill=(255, 255, 255))

        # Black legend text (no slash!)
        text = np.random.choice(restriction_texts)
        try:
            font_size = int(48 + np.random.uniform(-8, 8))
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
        except (OSError, IOError):
            font = ImageFont.load_default()

        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text((cx - tw // 2, cy - th // 2), text, fill=(0, 0, 0), font=font)

        img = img.rotate(rotation, fillcolor=(230, 230, 230))

        img_array = np.array(img, dtype=np.float32) * brightness
        img_array = np.clip(img_array, 0, 255).astype(np.uint8)
        img = Image.fromarray(img_array)

        img.save(restriction_dir / f"synth_restriction_{i:04d}.png")

    print(f"  Created {count} synthetic restriction sign images.")


def build_model(num_classes: int = 7, unfreeze_top_n: int = 0):
    """
    Build MobileNet v3 Small with custom classification head.

    Args:
        num_classes: Number of output categories (7 for AS 1319)
        unfreeze_top_n: Number of base model layers to unfreeze for fine-tuning.
                        0 = freeze entire base (faster, good for Phase 1).
    """
    # MobileNet v3 Small — smallest variant, fast inference on mobile
    base_model = keras.applications.MobileNetV3Small(
        input_shape=(IMG_SIZE, IMG_SIZE, 3),
        include_top=False,
        weights='imagenet',
    )

    # Freeze base model
    base_model.trainable = False

    # Optionally unfreeze top N layers for fine-tuning
    if unfreeze_top_n > 0:
        base_model.trainable = True
        for layer in base_model.layers[:-unfreeze_top_n]:
            layer.trainable = False
        print(f"Unfroze top {unfreeze_top_n} layers of base model")

    # Build full model
    inputs = keras.Input(shape=(IMG_SIZE, IMG_SIZE, 3))

    # Preprocessing: scale to [-1, 1] (matches MobileNet v3 expected input)
    x = layers.Rescaling(1./127.5, offset=-1)(inputs)

    x = base_model(x, training=False)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.Dense(128, activation='relu')(x)
    x = layers.Dropout(0.3)(x)
    outputs = layers.Dense(num_classes, activation='softmax')(x)

    model = keras.Model(inputs, outputs)
    return model


def train(args):
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    data_dir = Path(args.data)

    # Synthesise missing categories
    synthesise_danger_signs(data_dir, count=500)
    synthesise_restriction_signs(data_dir, count=500)

    # Create datasets
    print("Loading datasets...")
    train_ds, val_ds, test_ds = create_datasets(data_dir, args.batch)

    # Apply augmentation to training set
    augment = build_augmentation_layer()

    def augment_map(images, labels):
        return augment(images, training=True), labels

    train_ds = train_ds.map(augment_map, num_parallel_calls=AUTOTUNE)
    train_ds = train_ds.prefetch(AUTOTUNE)
    val_ds = val_ds.prefetch(AUTOTUNE)
    test_ds = test_ds.prefetch(AUTOTUNE)

    # Build model
    print("Building model...")
    model = build_model(num_classes=len(CATEGORIES), unfreeze_top_n=args.unfreeze)

    # Use lower learning rate if fine-tuning base layers
    lr = 1e-4 if args.unfreeze > 0 else 1e-3

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=lr),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy'],
    )

    model.summary()

    # Callbacks
    cb = [
        callbacks.EarlyStopping(patience=5, restore_best_weights=True, monitor='val_accuracy'),
        callbacks.ReduceLROnPlateau(factor=0.5, patience=3, monitor='val_loss'),
        callbacks.ModelCheckpoint(
            str(output_dir / 'best_model.keras'),
            save_best_only=True, monitor='val_accuracy'
        ),
    ]

    # Train
    print(f"\nPhase 1: Training head for up to {args.epochs} epochs...")
    history = model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=args.epochs,
        callbacks=cb,
    )

    # Phase 2: Fine-tune top conv layers if requested
    if args.finetune > 0:
        print(f"\nPhase 2: Fine-tuning top {args.finetune} layers at lr=1e-5...")
        base = model.layers[2]  # MobileNetV3Small is the 3rd layer (after input + rescaling)
        base.trainable = True
        for layer in base.layers[:-args.finetune]:
            layer.trainable = False

        model.compile(
            optimizer=keras.optimizers.Adam(learning_rate=1e-5),
            loss='sparse_categorical_crossentropy',
            metrics=['accuracy'],
        )

        ft_cb = [
            callbacks.EarlyStopping(patience=4, restore_best_weights=True, monitor='val_accuracy'),
            callbacks.ReduceLROnPlateau(factor=0.5, patience=2, monitor='val_loss'),
            callbacks.ModelCheckpoint(
                str(output_dir / 'best_model_ft.keras'),
                save_best_only=True, monitor='val_accuracy'
            ),
        ]

        ft_history = model.fit(
            train_ds,
            validation_data=val_ds,
            epochs=15,
            callbacks=ft_cb,
        )
        # Merge histories for plotting
        for key in history.history:
            history.history[key].extend(ft_history.history[key])

    # Evaluate on test set
    print("\nEvaluating on test set...")
    test_loss, test_acc = model.evaluate(test_ds)
    print(f"Test accuracy: {test_acc:.4f}")

    # Detailed classification report
    y_true, y_pred = [], []
    for images, labels in test_ds:
        preds = model.predict(images, verbose=0)
        y_true.extend(labels.numpy())
        y_pred.extend(np.argmax(preds, axis=1))

    print("\nClassification Report:")
    print(classification_report(y_true, y_pred, target_names=CATEGORIES))

    # Save model in SavedModel format (for TF.js conversion)
    saved_model_path = output_dir / 'as1319_category_model'
    try:
        model.export(str(saved_model_path))
    except (TypeError, AttributeError):
        # Fallback for TF versions where export() signature differs
        model.save(str(saved_model_path), save_format='tf')
    print(f"\nSavedModel exported to: {saved_model_path}")

    # Save training metadata
    metadata = {
        'categories': CATEGORIES,
        'img_size': IMG_SIZE,
        'test_accuracy': float(test_acc),
        'epochs_trained': len(history.history['loss']),
        'preprocessing': 'rescale_to_minus1_plus1',
        'base_model': 'MobileNetV3Small',
        'unfrozen_layers': args.unfreeze,
    }
    with open(output_dir / 'model_metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)

    # Plot training curves
    plot_training_history(history, output_dir)

    print(f"\nDone! Model and artifacts saved to: {output_dir}")
    print(f"Next step: python convert_to_tfjs.py --model {saved_model_path}")


def plot_training_history(history, output_dir: Path):
    """Save training accuracy and loss plots."""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))

    ax1.plot(history.history['accuracy'], label='Train')
    ax1.plot(history.history['val_accuracy'], label='Validation')
    ax1.set_title('Accuracy')
    ax1.set_xlabel('Epoch')
    ax1.legend()

    ax2.plot(history.history['loss'], label='Train')
    ax2.plot(history.history['val_loss'], label='Validation')
    ax2.set_title('Loss')
    ax2.set_xlabel('Epoch')
    ax2.legend()

    plt.tight_layout()
    plt.savefig(output_dir / 'training_curves.png', dpi=150)
    print(f"Training curves saved to: {output_dir / 'training_curves.png'}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Train AS 1319 category classifier')
    parser.add_argument('--data', required=True, help='Path to organised dataset directory')
    parser.add_argument('--output', default='./output', help='Output directory for model artifacts')
    parser.add_argument('--epochs', type=int, default=25, help='Max training epochs')
    parser.add_argument('--batch', type=int, default=32, help='Batch size')
    parser.add_argument('--unfreeze', type=int, default=0,
                        help='Number of base model layers to unfreeze from start (0=frozen, use --finetune instead)')
    parser.add_argument('--finetune', type=int, default=0,
                        help='Two-stage: train head first, then unfreeze top N layers at lr=1e-5 (recommended: 5)')
    args = parser.parse_args()
    train(args)
