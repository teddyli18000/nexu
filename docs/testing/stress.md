# 压力测试 / 性能基准

> 返回 [测试总览](../TESTING.md)

性能基准测试帮助识别多租户架构的瓶颈。

## 1. Config 生成性能

**目标：** 验证大规模 pool 下 `generatePoolConfig` 的响应时间。

| 规模 | Bot 数 | Channel / Bot | 预期耗时 |
|------|--------|---------------|---------|
| 小型 | 10 | 2 | < 100ms |
| 中型 | 50 | 2 | < 500ms |
| 大型 | 100 | 2 | < 2s |

**方法：**
```
1. 在测试 DB 中批量插入 N 个 bot + 2N 个 channel + 4N 个 credential
2. 调用 generatePoolConfig 20 次
3. 记录 p50 / p95 / p99 耗时
4. 验证生成的配置 Zod schema 通过
```

**指标：**
- p50 / p95 / p99 延迟
- 生成的 JSON 大小（bytes）
- DB 查询次数（N+1 问题检测）

## 2. 加解密吞吐量

**目标：** 确认 AES-256-GCM 加解密在凭据密集场景下的性能。

| 操作 | 次数 | 预期吞吐 |
|------|------|---------|
| encrypt | 1000 | > 5000 ops/s |
| decrypt | 1000 | > 5000 ops/s |
| 往返 | 1000 | > 3000 ops/s |

**方法：**
```
1. 生成 1000 个不同长度的明文（10B ~ 1KB）
2. 顺序执行 encrypt → decrypt
3. 记录总耗时和 ops/s
4. 检查内存占用无异常增长
```

## 3. Slack 签名验证吞吐量

**目标：** 签名验证是每个 Slack event 的必经路径，需确认不成为瓶颈。

| 操作 | 次数 | 预期吞吐 |
|------|------|---------|
| verifySlackSignature | 10000 | > 50000 ops/s |

**方法：**
```
1. 预生成合法的 secret + timestamp + rawBody + signature
2. 循环调用 verifySlackSignature 10000 次
3. 记录总耗时
```

## 4. Config Snapshot 并发写入

**目标：** 多个 bot 同时变更时，snapshot 发布无死锁、无重复版本。

**方法：**
```
1. 创建 1 个 pool + 10 个 bot
2. 并发执行 10 个 publishPoolConfigSnapshot（每次前修改一个 bot 名称）
3. 验证：
   - 无 DB 死锁（无超时错误）
   - 最终版本号 = 初始版本 + 实际变更数（hash 去重后）
   - 所有 snapshot 的 config_json 可被 Zod parse
```

## 5. 数据库连接池压力

**目标：** 高并发 API 调用下 pg pool 不会耗尽。

| 场景 | 并发数 | 持续时间 |
|------|--------|---------|
| Bot 列表查询 | 50 | 10s |
| Channel 列表查询 | 50 | 10s |
| Config 生成 | 20 | 10s |

**方法：**
```
1. 使用 Promise.all 模拟并发请求
2. 每个请求执行完整的 DB 查询链路
3. 监控：错误率、平均延迟、连接池等待时间
```

## 6. API 端点负载测试（需 k6）

> 以下测试针对 test 环境 (`nexu-api.powerformer.net`) 运行。

| 端点 | 并发用户 | 持续 | 关注指标 |
|------|---------|------|---------|
| `GET /health` | 100 | 30s | p99 延迟 < 50ms |
| `GET /api/v1/bots` | 50 | 30s | p99 延迟 < 200ms |
| `POST /api/slack/events` | 50 | 30s | 签名验证 + DB 查询 + 转发全链路 |
| `GET /api/internal/pools/{id}/config` | 20 | 30s | 大 pool 配置生成 |

**k6 脚本模板：**
```javascript
// k6 run --vus 50 --duration 30s scripts/load-test-bots.js
import http from "k6/http";
import { check } from "k6";

export default function () {
  const res = http.get("https://nexu-api.powerformer.net/api/v1/bots", {
    headers: { "x-api-key": __ENV.TEST_API_KEY },
  });
  check(res, {
    "status is 200": (r) => r.status === 200,
    "response time < 200ms": (r) => r.timings.duration < 200,
  });
}
```
