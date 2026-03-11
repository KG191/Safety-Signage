# AS 1319 Category Classifier — Training Pipeline

Train a MobileNet v3 Small to classify safety sign images into 7 AS 1319 categories,
then convert to TF.js for browser deployment.

## Prerequisites

- Python 3.9+
- macOS with Apple Silicon (M1/M2/M3/M4) works great — `tensorflow-metal` gives GPU acceleration
- Intel Mac works too (CPU-only, ~1-2 hours instead of ~30 min)
- ~12GB disk for dataset + training artifacts

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Download ORP-SIG-2024 dataset (see Step 1 below)

# 3. Organise dataset into AS 1319 categories
python organise_dataset.py --input ./orp-sig-2024 --output ./dataset

# 4. Train the model
python train.py --data ./dataset --epochs 25 --batch 32

# 5. Convert to TF.js
python convert_to_tfjs.py --model ./output/as1319_category_model

# 6. Host the contents of ./output/tfjs_model/ on a CDN
```

## Step 1: Download ORP-SIG-2024

1. Go to https://data.mendeley.com/datasets/dfg5hnxrzg/1
2. Click "Download" (you may need a free Mendeley account)
3. Extract into `./orp-sig-2024/`
4. You should see folders for each ISO 7010 pictogram (P001, P002, M001, etc.)

The dataset contains 94,080 images across 299 pictograms in 5 ISO 7010 categories,
including augmented and degraded variants for real-world robustness.

## Step 2: Train

`train.py` handles everything:
- Maps ISO 7010 folders to 7 AS 1319 categories
- Splits 80/10/10 train/val/test
- Fine-tunes MobileNet v3 Small (frozen conv base + custom head)
- Augments with rotation, brightness, blur, noise
- Exports SavedModel format

Expected results: ~90% validation accuracy in 20-25 epochs (~30 min on Colab T4).

## Step 3: Convert & Host

`convert_to_tfjs.py` produces a `tfjs_model/` directory containing:
- `model.json` (topology + weights manifest)
- `group1-shard1of1.bin` (or multiple shards, ~4-6MB total)

Host these files on any static CDN:
- GitHub Releases (free, easy)
- Cloudflare R2 (free tier, fast)
- AWS S3 + CloudFront
- Firebase Hosting

Then set the URL in the app: Settings > ML Sign Detection Model > Custom Model URL
pointing to the `model.json` file.
