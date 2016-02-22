#include <gflags/gflags.h>
#include <glog/logging.h>

#include "master.h"
#include "worker.h"

DEFINE_bool(master, false, "run as master mode");

int main(int argc, char* argv[]) {
  gflags::ParseCommandLineFlags(&argc, &argv, true);
  google::InitGoogleLogging(argv[0]);

  FLAGS_logtostderr = 1;

  if (FLAGS_master) {
    LOG(INFO) << "running as master mode...";
    RunMaster();
  } else {
    LOG(INFO) << "running as worker mode...";
    RunWorker();
  }
  return 0;
}
