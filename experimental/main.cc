#include <iostream>
#include <string>

#include <grpc++/grpc++.h>

#include "lodepng.h"
#include "picosha2.h"
#include "francine.grpc.pb.h"

extern void init_scene();
extern void render(unsigned char *img, int w, int h, int nsubsamples);

namespace {

std::string AoBench(const int width=256,
                    const int height=256,
                    const int nsubsamples=2) {

  std::vector<unsigned char> img(width * height * 3);
  render(img.data(), width, height, nsubsamples);

  std::vector<unsigned char> img4(width * height * 4);
  for (int i = 0; i < width * height; ++i) {
    img4[4 * i + 0] = img[3 * i + 0];
    img4[4 * i + 1] = img[3 * i + 1];
    img4[4 * i + 2] = img[3 * i + 2];
    img4[4 * i + 3] = 255;
  }

  std::vector<unsigned char> png;
  lodepng::encode(png, img4, width, height);

  return std::string(png.begin(), png.end());
}

class FrancineWorkerServiceImpl final
    : public francine::FrancineWorker::Service {
 public:
  grpc::Status Run(grpc::ServerContext* context,
                   grpc::ServerReaderWriter<francine::RunResponse,
                                            francine::RunRequest>*
                   stream) override {
    std::cerr<<"rendering started"<<std::endl;
    francine::RunRequest request;
    if (!stream->Read(&request)) {
      return grpc::Status(grpc::INVALID_ARGUMENT, "");
    }
    if (request.renderer() != francine::Renderer::AOBENCH) {
      return grpc::Status(grpc::UNIMPLEMENTED, "");
    }

    francine::RunResponse response;
    response.set_id(AddInmemoryFile(AoBench()));
    response.set_image_type(francine::ImageType::PNG);
    stream->Write(response);

    std::cerr<<"rendering finished"<<std::endl;
    return grpc::Status::OK;
  }

  grpc::Status Get(grpc::ServerContext* context,
                   const francine::GetRequest* request,
                   grpc::ServerWriter<francine::GetResponse>* writer) override {
    std::cerr<<"file requested"<<std::endl;
    if (!inmemory_files_.count(request->id())) {
      return grpc::Status(grpc::NOT_FOUND, "");
    }

    francine::GetResponse response;
    response.set_content(inmemory_files_[request->id()]);
    writer->Write(response);

    std::cerr<<"file transfered"<<std::endl;
    return grpc::Status::OK;
  }

 private:
  std::string AddInmemoryFile(const std::string& content) {
    std::string hash;
    picosha2::hash256_hex_string(content, hash);
    inmemory_files_[hash] = content;
    return hash;
  }

  std::map<std::string, std::string> inmemory_files_;
};

void RunWorker() {
  init_scene();

  const std::string server_address = "0.0.0.0:50052";

  FrancineWorkerServiceImpl service;
  grpc::ServerBuilder builder;

  builder.AddListeningPort(server_address, grpc::InsecureServerCredentials());
  builder.RegisterService(&service);

  std::unique_ptr<grpc::Server> server(builder.BuildAndStart());
  server->Wait();
}

class FrancineServiceImpl final : public francine::Francine::Service {
 public:
  FrancineServiceImpl()
      : francine::Francine::Service()
      , stub_(francine::FrancineWorker::NewStub(
            grpc::CreateChannel("localhost:50052",
                                grpc::InsecureChannelCredentials()))) {
  }

  grpc::Status Render(grpc::ServerContext* context,
                      const francine::RenderRequest* request,
                      francine::RenderResponse* response) override {
    grpc::ClientContext client_context;
    std::shared_ptr<grpc::ClientReaderWriter<francine::RunRequest, francine::RunResponse>> stream(
        stub_->Run(&client_context));

    francine::RunRequest run_request;
    run_request.set_renderer(francine::Renderer::AOBENCH);
    stream->Write(run_request);
    stream->WritesDone();

    francine::RunResponse run_response;
    stream->Read(&run_response);
    auto status = stream->Finish();
    if (!status.ok()) {
      return status;
    }

    francine::GetRequest get_request;
    get_request.set_id(run_response.id());
    grpc::ClientContext client_context2;
    std::shared_ptr<grpc::ClientReader<francine::GetResponse>> reader(
        stub_->Get(&client_context2, get_request));
    francine::GetResponse get_response;
    reader->Read(&get_response);
    status = reader->Finish();
    if (!status.ok()) {
      return status;
    }

    response->set_image(get_response.content());
    response->set_image_type(run_response.image_type());

    return grpc::Status::OK;
  }

  std::unique_ptr<francine::FrancineWorker::Stub> stub_;
};

void RunMaster() {
  const std::string server_address = "0.0.0.0:50051";

  FrancineServiceImpl service;
  grpc::ServerBuilder builder;

  builder.AddListeningPort(server_address, grpc::InsecureServerCredentials());
  builder.RegisterService(&service);

  std::unique_ptr<grpc::Server> server(builder.BuildAndStart());
  server->Wait();
}

}  // namespace

int main(int argc, char* argv[]) {
  if (argc > 1 && std::string(argv[1]) == "--master") {
    RunMaster();
  } else {
    RunWorker();
  }
  return 0;
}
