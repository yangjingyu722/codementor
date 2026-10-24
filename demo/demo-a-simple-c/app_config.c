#include "app_config.h"
#include <stddef.h>

struct app_config g_config;

void load_config(void) {
    g_config.host = "localhost";
    g_config.port = 8080;
    g_config.verbose = 0;
}

/* 启动时校验：坏配置让调用方尽早失败（对应设计决策）。 */
int validate_config(void) {
    if (g_config.host == NULL) {
        return -1;
    }
    return g_config.port > 0 ? 0 : -1;
}
