// Compositor: composite PNG, JPEG, EXR images

#include <cassert>
#include <cstdio>
#include <string>
#include <vector>

#include "jpgd.h"
#include "jpge.h"
#include "lodepng.h"
#include "tinyexr.h"

namespace {

enum ImageFileFormats {
  kFormatError,
  kFormatPng,
  kFormatJpg,
  kFormatExr
};

int LoadPng(const std::string& file_name, std::vector<double>* image, int* width, int* height) {
  std::vector<unsigned char> decoded_image;
  unsigned unsigned_with, unsigned_height;

  unsigned error = lodepng::decode(decoded_image, unsigned_with, unsigned_height, file_name);
  if (error) {
    fprintf(stderr, "failed to decode png image\n");
    return 1;
  }

  *width = unsigned_with;
  *height = unsigned_height;

  image->resize(decoded_image.size());
  for (int i = 0; i < decoded_image.size(); ++i) {
    (*image)[i] = decoded_image[i];
  }
  return 0;
}

int LoadJpg(const std::string& file_name, std::vector<double>* image, int* width, int* height) {
  int actual_comps;

  unsigned char* decoded_image =
    jpgd::decompress_jpeg_image_from_file(file_name.c_str(), width, height, &actual_comps, 4);

  if (decoded_image == NULL) {
    fprintf(stderr, "failed to decode JPEG image\n");
    return 1;
  }

  image->resize(*width * *height * 4);
  for (int i = 0; i < image->size(); ++i) {
    (*image)[i] = decoded_image[i];
  }
  return 0;
}

int LoadExr(const std::string& file_name, std::vector<double>* image, int* width, int* height) {
  float* out_rgba;
  const char* error;

  if (LoadEXR(&out_rgba, width, height, file_name.c_str(), &error)) {
    fprintf(stderr, "failed to decode EXR image: %s\n", error);
    return 1;
  }

  image->resize(*width * *height * 4);
  for (int i = 0; i < image->size(); ++i) {
    (*image)[i] = out_rgba[i];
  }
  return 0;
}

ImageFileFormats ReadFileSignature(const std::string& file_name) {
  FILE *fp = fopen(file_name.c_str(), "r");
  if (fp == NULL) {
    return kFormatError;
  }

  ImageFileFormats result = kFormatError;

  unsigned char sig[4];
  fread(sig, 4, 1, fp);

  if (sig[0] == 0x89 &&
      sig[1] == 0x50 &&
      sig[2] == 0x4E &&
      sig[3] == 0x47) {
    result = kFormatPng;
  } else if (sig[0] == 0xFF &&
             sig[1] == 0xD8 &&
             sig[2] == 0xFF &&
             sig[3] == 0xE0) {
    result = kFormatJpg;
  } else if (sig[0] == 0x76 &&
             sig[1] == 0x2F &&
             sig[2] == 0x31 &&
             sig[3] == 0x01) {
    result = kFormatExr;
  }

  fclose(fp);

  return result;
}

int LoadImage(const std::string& file_name, std::vector<double>* image, int* width, int* height) {
  switch (ReadFileSignature(file_name)) {
    case kFormatError:
      fprintf(stderr, "failed to get the format of the input file %s", file_name.c_str());
      return 1;
    case kFormatPng:
      return LoadPng(file_name, image, width, height);
    case kFormatJpg:
      return LoadJpg(file_name, image, width, height);
    case kFormatExr:
      return LoadExr(file_name, image, width, height);
  }
}

int SavePng(const std::string& file_name, const std::vector<unsigned char>& image, int width, int height) {
  unsigned error = lodepng::encode(file_name, image, width, height);
  if (error) {
    fprintf(stderr, "failed to encode png image\n");
    return 1;
  }
  return 0;
}

int SaveJpg(const std::string& file_name, const std::vector<unsigned char>& image, int width, int height) {
  std::vector<unsigned char> three_channel_image(image.size() / 4 * 3);
  for (int i = 0, i_max = image.size() / 4; i < i_max; ++i) {
    three_channel_image[3 * i + 0] = image[4 * i + 0];
    three_channel_image[3 * i + 1] = image[4 * i + 1];
    three_channel_image[3 * i + 2] = image[4 * i + 2];
  }
  jpge::compress_image_to_jpeg_file(file_name.c_str(), width, height, 3, &three_channel_image[0]);
  return 0;
}

int SaveExr(const std::string& file_name, const std::vector<unsigned char>& image, int width, int height) {
  assert(false);
}

}  // namespace

int main(int argc, char *argv[]) {
	if (argc < 4) {
		fprintf(stderr, "usage: compositor <output type> <output file> <input files> ...\n");
		fprintf(stderr, "<output type> = png | jpg | exr\n");
		return 1;
	}

  std::string output_type = argv[1];
  std::string output_file_name = argv[2];
  std::vector<std::string> input_file_names;
  for (int i = 3; i < argc; ++i) {
    input_file_names.push_back(argv[i]);
  }

  std::vector<double> accumulated;
  double count = 0;
  int width, height;

  for (std::vector<std::string>::iterator it = input_file_names.begin();
       it != input_file_names.end(); ++it) {
    std::vector<double> image;
    int current_width, current_height;
    if (LoadImage(*it, &image, &current_width, &current_height)) {
      fprintf(stderr, "failed to load image %s\n", it->c_str());
      return 1;
    }

    if (accumulated.size() == 0) {
      accumulated.resize(image.size());
      width = current_width;
      height = current_height;
    }

    for (int i = 0; i < image.size(); ++i) {
      accumulated[i] += image[i];
    }

    ++count;
  }

  for (int i = 0; i < accumulated.size(); ++i) {
    accumulated[i] /= count;
  }

  std::vector<unsigned char> output_image(accumulated.size());
  for (int i = 0; i < accumulated.size(); ++i) {
    output_image[i] = accumulated[i];
  }

	if (output_type == "png") {
    return SavePng(output_file_name, output_image, width, height);
	} else if (output_type == "jpg") {
    return SaveJpg(output_file_name, output_image, width, height);
	} else if (output_type == "exr") {
    return SaveExr(output_file_name, output_image, width, height);
	} else {
		fprintf(stderr, "unsupported output file format %s\n", output_type.c_str());
		return 1;
	}
}
