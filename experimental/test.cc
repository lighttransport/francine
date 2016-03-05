#include <gflags/gflags.h>
#include <glog/logging.h>
#include <grpc++/grpc++.h>
#include <iostream>
#include <fstream>

#include "francine.grpc.pb.h"

using francine::Francine;
using francine::Renderer;
using francine::RenderRequest;
using francine::RenderResponse;
using francine::UploadDirectRequest;
using francine::UploadResponse;
using grpc::CreateChannel;
using grpc::ClientContext;
using grpc::InsecureChannelCredentials;

DEFINE_string(address, "localhost:50051", "Master address");
DEFINE_bool(aobench, false, "Test embedded AOBench");
DEFINE_bool(pbrt, false, "Test PBRT renderer");
DEFINE_string(pbrt_scenes_dir, "", "PBRT scenes directory");

namespace {

// Returns true if failed.
bool UploadFiles(const std::vector<std::string>& files,
                 const std::string& prefix,
                 std::unique_ptr<Francine::Stub>& stub,
                 std::vector<std::string> *file_ids) {
  file_ids->clear();

  for (auto&& filename : files) {
    std::ifstream ifs(prefix + "/" + filename);
    if (!ifs.good()) {
      return false;
    }

    std::string content((std::istreambuf_iterator<char>(ifs)),
                        std::istreambuf_iterator<char>());

    auto context = std::make_shared<ClientContext>();
    UploadDirectRequest upload_request;
    upload_request.set_content(content);

    UploadResponse upload_response;
    auto status = stub->UploadDirect(
        context.get(), upload_request, &upload_response);

    if (status.ok()) {
      LOG(INFO) << "UploadDirect succeeded. file id: " << upload_response.id();
      file_ids->push_back(upload_response.id());
    } else {
      LOG(INFO) << "UploadDirect failed.";
      return true;
    }
  }

  return false;
}

}  // namespace

int main(int argc, char* argv[]) {
  gflags::ParseCommandLineFlags(&argc, &argv, true);
  google::InitGoogleLogging(argv[0]);

  FLAGS_logtostderr = 1;

  if (!FLAGS_aobench && !FLAGS_pbrt) {
    LOG(ERROR) << "Please specify --aobench or --pbrt";
    return 1;
  }

  std::unique_ptr<Francine::Stub> stub(
      Francine::NewStub(
        CreateChannel(FLAGS_address, InsecureChannelCredentials())));

  RenderRequest request;
  if (FLAGS_aobench) {
    request.set_renderer(Renderer::AOBENCH);
  } else if (FLAGS_pbrt) {
    request.set_renderer(Renderer::PBRT);

    std::vector<std::string> files = {
      "buddha.pbrt",
      "textures/doge2_latlong.exr",
      "spds/metals/Cu_palik.eta.spd",
      "spds/metals/Cu_palik.k.spd",
      "geometry/happy.pbrt"
    };

    if (FLAGS_pbrt_scenes_dir.empty()) {
      LOG(ERROR) << "Please specify --pbrt_scenes_dir";
      return 1;
    }

    std::vector<std::string> file_ids;

    if (UploadFiles(files, FLAGS_pbrt_scenes_dir, stub, &file_ids)) {
      LOG(ERROR) << "Failed to upload resources";
      return 1;
    }

    for (int i = 0; i < files.size(); ++i) {
      auto file = request.add_files();
      file->set_id(file_ids[i]);
      file->set_alias(files[i]);
    }
  }

  auto context = std::make_shared<ClientContext>();
  RenderResponse response;
  auto status = stub->Render(context.get(), request, &response);

  if (status.ok()) {
    LOG(INFO) << "Render succeeded";
  } else {
    LOG(ERROR) << "Render failed";
    return 1;
  }

  std::cout<<response.image()<<std::endl;

  return 0;
}
