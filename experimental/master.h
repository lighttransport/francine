#ifndef FRANCINE_MASTER_H_
#define FRANCINE_MASTER_H_

#include <grpc++/grpc++.h>
#include <memory>
#include <set>
#include <vector>

#include "francine.grpc.pb.h"
#include "node_manager.h"
#include "master_file_manager.h"

class FrancineServiceImpl final : public francine::Francine::Service {
 public:
  FrancineServiceImpl();

  virtual grpc::Status Render(
      grpc::ServerContext* context,
      const francine::RenderRequest* request,
      francine::RenderResponse* response) override;

  virtual grpc::Status UploadDirect(
      grpc::ServerContext* context,
      const francine::UploadDirectRequest* request,
      francine::UploadResponse* response) override;

  virtual grpc::Status RenderStream(
      grpc::ServerContext* context,
      grpc::ServerReaderWriter<francine::RenderResponse,
                               francine::RenderRequest>* stream) override;

  virtual grpc::Status UploadDirectStream(
      grpc::ServerContext* context,
      grpc::ServerReader<francine::UploadDirectRequest>* reader,
      francine::UploadResponse* response) override;

 private:
  NodeManager node_manager_;
  MasterFileManager master_file_manager_;
};

void RunMaster();

#endif
