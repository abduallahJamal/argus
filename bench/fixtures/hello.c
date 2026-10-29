#include <stdio.h>
#include <unistd.h>
int main(void){ printf("%d\n", geteuid()); return 0; }
