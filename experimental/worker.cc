#include "worker.h"

#include <fstream>
#include <gflags/gflags.h>
#include <glog/logging.h>
#include <sstream>
#include <string>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

#include "ao.h"
#include "jpgd.h"
#include "jpge.h"
#include "lodepng.h"
#include "tinyexr.h"

using francine::FrancineWorker;
using francine::ImageType;
using francine::Renderer;
using francine::RunRequest;
using francine::RunResponse;
using francine::ComposeRequest;
using francine::ComposeResponse;
using francine::TransferRequest;
using francine::TransferResponse;
using francine::PutRequest;
using francine::PutResponse;
using francine::GetRequest;
using francine::GetResponse;
using francine::DeleteRequest;
using francine::DeleteResponse;
using grpc::CreateChannel;
using grpc::ClientContext;
using grpc::ClientReader;
using grpc::InsecureChannelCredentials;
using grpc::Status;
using grpc::Server;
using grpc::ServerBuilder;
using grpc::ServerContext;
using grpc::ServerReader;
using grpc::ServerReaderWriter;
using grpc::ServerWriter;

DEFINE_string(worker_address, "0.0.0.0:50052", "worker address to bind");

namespace {

bool LoadPng(const std::string& content, std::vector<double>* image,
             int* width, int* height) {
  std::vector<unsigned char> png(content.size());
  for (int i = 0; i < content.size(); ++i) {
    png[i] = content[i];
  }

  std::vector<unsigned char> decoded_image;
  unsigned unsigned_with, unsigned_height;

  unsigned error = lodepng::decode(decoded_image,
                                   unsigned_with, unsigned_height, png);
  if (error) {
    LOG(ERROR) << "failed to decode PNG image";
    return true;
  }

  *width = unsigned_with;
  *height = unsigned_height;

  image->resize(decoded_image.size());
  for (int i = 0; i < decoded_image.size(); ++i) {
    (*image)[i] = decoded_image[i];
  }
  return false;
}

/*
bool LoadJpg(const std::string& content, std::vector<double>* image,
             int* width, int* height) {
  int actual_comps;

  unsigned char* decoded_image =
    jpgd::decompress_jpeg_image_from_file(file_name.c_str(),
                                          width, height, &actual_comps, 4);

  if (decoded_image == NULL) {
    LOG(ERROR) << "failed to decode JPEG image";
    return true;
  }

  image->resize(*width * *height * 4);
  for (int i = 0; i < image->size(); ++i) {
    (*image)[i] = decoded_image[i];
  }
  return false;
}

bool LoadExr(const std::string& content, std::vector<double>* image,
             int* width, int* height) {
  float* out_rgba;
  const char* error;

  if (LoadEXR(&out_rgba, width, height, file_name.c_str(), &error)) {
    LOG(ERROR) << "failed to decode EXR image: " << error;
    return true;
  }

  image->resize(*width * *height * 4);
  for (int i = 0; i < image->size(); ++i) {
    (*image)[i] = out_rgba[i];
  }
  return false;
}
*/

bool LoadImage(ImageType image_type,
    const std::string& content, std::vector<double>* image,
    int* width, int* height) {
  if (image_type == ImageType::PNG) {
    return LoadPng(content, image, width, height);
  } else {
    LOG(ERROR) << "unsupported image type to load";
    return true;
  }
}

bool SavePng(const std::vector<double>& image,
             int width, int height, std::string *content) {
  std::vector<unsigned char> output_image(image.size());
  for (int i = 0; i < image.size(); ++i) {
    output_image[i] = image[i];
  }

  std::vector<unsigned char> png;
  unsigned error = lodepng::encode(png, output_image, width, height);
  if (error) {
    LOG(ERROR) << "failed to encode PNG image";
    return true;
  }

  *content = std::string(png.begin(), png.end());

  return false;
}

bool SaveImage(ImageType image_type, const std::vector<double>& image,
    int width, int height, std::string *content) {
  if (image_type == ImageType::PNG) {
    return SavePng(image, width, height, content);
  } else {
    LOG(ERROR) << "unsupported image type to save";
    return true;
  }
}

/*
bool SaveJpg(const std::vector<double>& image,
             int width, int height, std::string *content) {
  std::vector<unsigned char> three_channel_image(image.size() / 4 * 3);
  for (int i = 0, i_max = image.size() / 4; i < i_max; ++i) {
    three_channel_image[3 * i + 0] = image[4 * i + 0];
    three_channel_image[3 * i + 1] = image[4 * i + 1];
    three_channel_image[3 * i + 2] = image[4 * i + 2];
  }
  jpge::compress_image_to_jpeg_file(file_name.c_str(),
                                    width, height, 3,
                                    &three_channel_image[0]);
  return false;
}

bool SaveExr(const std::vector<double>& image,
             int width, int height, std::string *content) {
  EXRImage exr;

  exr.num_channels = 4;

  const char *channel_names[] = {"R", "G", "B", "A"};
  exr.channel_names = channel_names;

  int pixel_types[] = {
    TINYEXR_PIXELTYPE_FLOAT,
    TINYEXR_PIXELTYPE_FLOAT,
    TINYEXR_PIXELTYPE_FLOAT,
    TINYEXR_PIXELTYPE_FLOAT};
  exr.pixel_types = pixel_types;

  exr.width = width;
  exr.height = height;

  std::vector<std::vector<float> > output_image(
      4,
      std::vector<float>(2 * width * height));

  for (int i = 0, i_max = image.size() / 4; i < i_max; ++i) {
    output_image[0][i] = image[4 * i + 0];
    output_image[1][i] = image[4 * i + 1];
    output_image[2][i] = image[4 * i + 2];
    output_image[3][i] = image[4 * i + 3];
  }

  unsigned char *images[4];
  for (int i = 0; i < 4; ++i) {
    images[i] = reinterpret_cast<unsigned char*>(&output_image[i]);
  }

  exr.images = images;

  const char *error;
  if (SaveMultiChannelEXRToFile(&exr, file_name.c_str(), &error)) {
    LOG(ERROR) << "failed to encode EXR image: " << error;
    return true;
  }

  return false;
}
*/

}  // namespace

Status FrancineWorkerServiceImpl::Run(
    ServerContext* context,
    ServerReaderWriter<RunResponse, RunRequest>* stream) {
  LOG(INFO) << "rendering started";

  RunRequest request;
  // TODO(peryaudo): Accept streaming requests if the renderer supports
  if (!stream->Read(&request)) {
    return Status(grpc::INVALID_ARGUMENT, "");
  }

  if (request.renderer() == Renderer::AOBENCH) {
    RunResponse response;
    std::string result_id;
    uint64_t result_size;
    if (file_manager_.Put(AoBench(), &result_id, &result_size)) {
      LOG(INFO) << "failed to obtain aobench rendering result";
      return Status(grpc::DATA_LOSS, "");
    }
    response.set_id(result_id);
    response.set_file_size(result_size);
    response.set_image_type(ImageType::PNG);
    stream->Write(response);
  } else if (request.renderer() == Renderer::PBRT) {
    std::vector<std::pair<std::string, std::string>> files;
    for (auto&& file : request.files()) {
      files.emplace_back(file.id(), file.alias());
    }
    std::string tmpdir;
    if (file_manager_.CreateTmpDir(files, &tmpdir)) {
      LOG(INFO) << "failed to create temporary directory";
      return Status(grpc::DATA_LOSS, "");
    }

    chdir(tmpdir.c_str());

    system("/home/peryaudo/pbrt-v2/src/bin/pbrt buddha.pbrt");

    std::string result_id;
    uint64_t result_size;
    if (file_manager_.Retain(tmpdir, "buddha.exr", &result_id, &result_size)) {
      LOG(INFO) << "failed to obtain PBRT rendering result";
      file_manager_.RemoveTmpDir(tmpdir);
      return Status(grpc::DATA_LOSS, "");
    }

    RunResponse response;
    response.set_id(result_id);
    response.set_file_size(result_size);
    response.set_image_type(ImageType::EXR);
    stream->Write(response);

    file_manager_.RemoveTmpDir(tmpdir);

    LOG(INFO) << "rendering finished";
    return grpc::Status::OK;
  } else {
    LOG(ERROR) << "the renderer type is not implemented";
    return Status(grpc::UNIMPLEMENTED, "");
  }

  LOG(INFO) << "rendering finished";
  return grpc::Status::OK;
}

Status FrancineWorkerServiceImpl::Compose(
    ServerContext* context,
    const ComposeRequest* request, ComposeResponse* response) {
  double weight_sum = 0.0;

  std::vector<double> accumulated;
  int width = -1, height = -1;

  for (auto&& image : request->images()) {
    const double weight = image.weight();
    weight_sum += weight;

    std::string content;
    if (file_manager_.Get(image.id(), &content)) {
      LOG(ERROR) << "compose failed; image " << image.id() << "not found";
      return Status(grpc::DATA_LOSS, "");
    }

    std::vector<double> decoded;
    int current_width, current_height;
    if (LoadImage(image.image_type(), content,
          &decoded, &current_width, &current_height)) {
      LOG(ERROR) << "compose failed; loading image " << image.id() << "failed";
      return Status(grpc::INTERNAL, "");
    }

    if (accumulated.size() == 0) {
      accumulated.resize(decoded.size());
      width = current_width;
      height = current_height;
    }

    for (int j = 0; j < accumulated.size(); ++j) {
      accumulated[j] += decoded[j] * weight;
    }
  }

  for (int i = 0; i < accumulated.size(); ++i) {
    accumulated[i] /= weight_sum;
  }

  std::string result;
  if (SaveImage(request->image_type(), accumulated, width, height, &result)) {
    LOG(ERROR) << "compose failed; failed to encode";
    return Status(grpc::INTERNAL, "");
  }

  std::string result_id;
  uint64_t result_size;
  if (file_manager_.Put(result, &result_id, &result_size)) {
    LOG(ERROR) << "failed to put compose result";
    return Status(grpc::INTERNAL, "");
  }

  response->set_id(result_id);
  response->set_file_size(result_size);

  return grpc::Status::OK;
}

Status FrancineWorkerServiceImpl::Transfer(
    ServerContext* context,
    const TransferRequest* request,
    TransferResponse* response) {
  LOG(INFO) << "transfer requested";

  std::unique_ptr<FrancineWorker::Stub> stub(
      FrancineWorker::NewStub(
        CreateChannel(request->src_address(), InsecureChannelCredentials())));

  GetRequest get_request;
  get_request.set_id(request->id());
  auto client_context = ClientContext::FromServerContext(*context);
  std::shared_ptr<ClientReader<GetResponse>> reader(
    stub->Get(client_context.get(), get_request));

  std::string content;
  GetResponse get_response;
  while (reader->Read(&get_response)) {
    content += get_response.content();
  }

  auto status = reader->Finish();
  if (!status.ok()) {
    LOG(INFO) << "transfer failed";
    return status;
  }
  
  std::string new_id;
  uint64_t file_size;
  if (file_manager_.Put(content, &new_id, &file_size) ||
      new_id != request->id()) {
    return Status(grpc::DATA_LOSS, "");
  }

  response->set_file_size(file_size);

  LOG(INFO) << "transfer finished";

  return Status::OK;
}

Status FrancineWorkerServiceImpl::Put(
    ServerContext* context,
    ServerReader<PutRequest>* reader, PutResponse* response) {

  LOG(INFO) << "put requested";

  PutRequest request;
  std::string content;
  while (reader->Read(&request)) {
    content += request.content();
  }

  LOG(INFO) << "put content size: " << content.size();

  std::string content_id;
  uint64_t content_size;
  file_manager_.Put(content, &content_id, &content_size);
  response->set_id(content_id);
  response->set_file_size(content_size);

  LOG(INFO) << "put finished";
  return Status::OK;
}

Status FrancineWorkerServiceImpl::Get(
    ServerContext* context,
    const GetRequest* request, ServerWriter<GetResponse>* writer) {
  // TODO(peryaudo): Progressively Write()
  LOG(INFO) << "get requested";

  std::string content;
  if (file_manager_.Get(request->id(), &content)) {
    LOG(ERROR) << "get failed";
    return Status(grpc::NOT_FOUND, "");
  }

  GetResponse response;
  response.set_content(content);
  writer->Write(response);
  LOG(INFO) << "get finished";
  return Status::OK;
}

Status FrancineWorkerServiceImpl::Delete(
    ServerContext* context,
    const DeleteRequest* request, DeleteResponse* response) {

  LOG(INFO) << "delete requested";

  if (file_manager_.Delete(request->id())) {
    LOG(ERROR) << "no such file " << request->id() << " exists; ignore";
  }

  return Status::OK;
}

void RunWorker() {
  FrancineWorkerServiceImpl service;
  ServerBuilder builder;

  builder.AddListeningPort(
      FLAGS_worker_address, grpc::InsecureServerCredentials());
  builder.RegisterService(&service);

  std::unique_ptr<Server> server(builder.BuildAndStart());

  LOG(INFO) << "Listen on " << FLAGS_worker_address;
  server->Wait();
}
