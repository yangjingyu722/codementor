#include <stdio.h>
#include "app_config.h"

int main(void) {
    load_config();
    if (validate_config() != 0) {
        fprintf(stderr, "invalid config\n");
        return 1;
    }
    printf("host=%s port=%d\n", g_config.host, g_config.port);
    return 0;
}
