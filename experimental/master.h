#ifndef FRANCINE_MASTER_H_
#define FRANCINE_MASTER_H_

#include <grpc++/grpc++.h>

#include "francine.grpc.pb.h"

class FrancineServiceImpl final : public francine::Francine::Service {
 public:
  FrancineServiceImpl();

  grpc::Status Render(grpc::ServerContext* context,
                      const francine::RenderRequest* request,
                      francine::RenderResponse* response) override;

  std::unique_ptr<francine::FrancineWorker::Stub> stub_;
};

void RunMaster();

#endif
