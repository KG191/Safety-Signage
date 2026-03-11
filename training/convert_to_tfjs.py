#!/usr/bin/env python3
"""
Convert a trained TensorFlow SavedModel to TensorFlow.js format for browser deployment.

Produces a directory containing:
  - model.json (topology + weights manifest)
  - group1-shard*.bin (weight data, ~4-6MB total)

Usage:
    python convert_to_tfjs.py --model ./output/as1319_category_model

The output tfjs_model/ directory can be hosted on any static file server or CDN.
Set the URL to model.json in the app's Settings > ML Sign Detection Model.
"""

import argparse
import json
import os
from pathlib import Path


def convert(model_path: Path, output_path: Path, quantize: bool = True):
    """Convert SavedModel to TF.js GraphModel format."""
    try:
        import tensorflowjs as tfjs
    except ImportError:
        print("Error: tensorflowjs not installed.")
        print("Install with: pip install tensorflowjs")
        return False

    output_path.mkdir(parents=True, exist_ok=True)

    print(f"Converting: {model_path}")
    print(f"Output:     {output_path}")
    print(f"Quantize:   {'uint16 (smaller file)' if quantize else 'none (full precision)'}")

    # Build conversion command arguments
    quantization = 'uint16' if quantize else None

    try:
        tfjs.converters.convert_tf_saved_model(
            str(model_path),
            str(output_path),
            quantization_dtype_map={quantization: '*'} if quantization else None,
        )
    except Exception as e:
        print(f"\nDirect API conversion failed: {e}")
        print("Falling back to CLI converter...")

        # Fallback: use CLI tool
        cmd = (
            f"tensorflowjs_converter "
            f"--input_format=tf_saved_model "
            f"--output_format=tfjs_graph_model "
        )
        if quantize:
            cmd += "--quantize_uint16 "
        cmd += f'"{model_path}" "{output_path}"'

        print(f"Running: {cmd}")
        exit_code = os.system(cmd)
        if exit_code != 0:
            print("Conversion failed!")
            return False

    # Verify output
    model_json = output_path / 'model.json'
    if not model_json.exists():
        print("Error: model.json not found in output directory!")
        return False

    # Calculate total size
    total_bytes = 0
    for f in output_path.iterdir():
        total_bytes += f.stat().st_size

    total_mb = total_bytes / (1024 * 1024)
    shard_files = list(output_path.glob('*.bin'))

    print(f"\nConversion successful!")
    print(f"  model.json: {model_json.stat().st_size / 1024:.1f} KB")
    print(f"  Weight shards: {len(shard_files)} files")
    print(f"  Total size: {total_mb:.2f} MB")

    # Add metadata to model.json for the app to read
    with open(model_json, 'r') as f:
        model_data = json.load(f)

    # Load training metadata if available
    metadata_path = model_path.parent / 'model_metadata.json'
    if metadata_path.exists():
        with open(metadata_path, 'r') as f:
            training_meta = json.load(f)
        model_data['as1319_metadata'] = training_meta
        with open(model_json, 'w') as f:
            json.dump(model_data, f)
        print(f"  Embedded training metadata from: {metadata_path}")

    print(f"\nNext steps:")
    print(f"  1. Upload contents of {output_path}/ to your CDN")
    print(f"  2. In the app, go to Settings > ML Sign Detection Model")
    print(f"  3. Set Custom Model URL to: https://your-cdn.com/path/to/model.json")

    return True


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Convert trained model to TF.js')
    parser.add_argument('--model', required=True, help='Path to SavedModel directory')
    parser.add_argument('--output', default='./output/tfjs_model', help='Output directory for TF.js model')
    parser.add_argument('--no-quantize', action='store_true',
                        help='Skip uint16 quantization (larger but full precision)')
    args = parser.parse_args()

    convert(Path(args.model), Path(args.output), quantize=not args.no_quantize)
