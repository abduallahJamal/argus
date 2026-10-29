/*
 * lockdemo.c — the native target for argus's "deep" benchmark task.
 *
 * Compiled by `node bench/setup.mjs` (gcc -O2 -o work/targets/lockdemo). The answer key in
 * tasks.json is derived from THIS file, so the benchmark is verifiable by reading the source:
 *
 *   socket path   /tmp/argusdemo.<euid>.<hash>.sock     (hash = FNV-1a of the executable path)
 *   wire protocol 4-byte big-endian length prefix, then a JSON body {"exe":"...","pid":N}
 *   peer auth     getpeereid() on the accepted fd; uid must equal geteuid()
 *
 * Everything here exists to be reversed by static analysis. Nothing is malicious: the program
 * only talks to a socket in /tmp under the current user's own uid.
 */
#define _GNU_SOURCE  /* struct ucred / SO_PEERCRED */
#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <unistd.h>

#define SLOT_MAGIC 0x41524753u /* "ARGS" */
#define MAX_BODY 4096

static unsigned int fnv1a(const char *s) {
  unsigned int h = 2166136261u;
  while (*s) { h ^= (unsigned char)*s++; h *= 16777619u; }
  return h;
}

static int exe_path(char *out, size_t n) {
#if defined(__APPLE__)
  extern int _NSGetExecutablePath(char *, unsigned int *);
  unsigned int sz = (unsigned int)n;
  return _NSGetExecutablePath(out, &sz);
#else
  ssize_t r = readlink("/proc/self/exe", out, n - 1);
  if (r < 0) return -1;
  out[r] = 0;
  return 0;
#endif
}

static void socket_path(char *out, size_t n) {
  char exe[1024];
  if (exe_path(exe, sizeof exe) != 0) strcpy(exe, "unknown");
  snprintf(out, n, "/tmp/argusdemo.%u.%08x.sock", (unsigned)geteuid(), fnv1a(exe));
}

static int send_frame(int fd, const char *exe) {
  char body[MAX_BODY];
  int n = snprintf(body, sizeof body, "{\"exe\":\"%s\",\"pid\":%d}", exe, (int)getpid());
  unsigned int be = htonl((unsigned int)n);
  if (write(fd, &be, 4) != 4) return -1;
  return write(fd, body, (size_t)n) == n ? 0 : -1;
}

static int peer_is_me(int fd) {
  uid_t uid = (uid_t)-1, gid = (gid_t)-1;
#if defined(__APPLE__) || defined(__FreeBSD__)
  if (getpeereid(fd, &uid, &gid) != 0) return 0;
#else
  struct ucred cred;
  socklen_t len = sizeof cred;
  if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &cred, &len) != 0) return 0;
  uid = cred.uid;
#endif
  return uid == geteuid();
}

int main(int argc, char **argv) {
  char path[256], exe[1024];
  socket_path(path, sizeof path);
  exe_path(exe, sizeof exe);

  if (argc > 1 && strcmp(argv[1], "--probe") == 0) {
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    struct sockaddr_un a = {0};
    a.sun_family = AF_UNIX;
    strncpy(a.sun_path, path, sizeof a.sun_path - 1);
    if (connect(fd, (struct sockaddr *)&a, sizeof a) != 0) { perror("connect"); return 1; }
    if (send_frame(fd, exe) != 0) { perror("send"); return 1; }
    puts("sent");
    close(fd);
    return 0;
  }

  unlink(path);
  int srv = socket(AF_UNIX, SOCK_STREAM, 0);
  struct sockaddr_un a = {0};
  a.sun_family = AF_UNIX;
  strncpy(a.sun_path, path, sizeof a.sun_path - 1);
  if (bind(srv, (struct sockaddr *)&a, sizeof a) != 0) { perror("bind"); return 1; }
  chmod(path, 0600);
  listen(srv, 4);
  printf("listening on %s (slot %08x)\n", path, SLOT_MAGIC);
  fflush(stdout);

  for (;;) {
    int c = accept(srv, NULL, NULL);
    if (c < 0) continue;
    if (!peer_is_me(c)) { close(c); continue; }
    unsigned int be = 0;
    if (read(c, &be, 4) == 4) {
      unsigned int len = ntohl(be);
      if (len < MAX_BODY) {
        char body[MAX_BODY + 1] = {0};
        if (read(c, body, len) > 0) printf("peer said: %s\n", body);
      }
    }
    close(c);
  }
  return 0;
}
