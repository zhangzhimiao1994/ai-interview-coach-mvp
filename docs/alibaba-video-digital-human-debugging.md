# 阿里双视频数字人配置与调试

本指南只描述配置和人工调试合同，不包含任何凭据。真实服务可达性必须由管理员使用自己的本机加密配置验证。

## 1. 私有 OSS

在与部署地域匹配的 OSS 创建私有 Bucket，禁止公共读和公共写。为应用创建独立的最小权限 RAM 身份，权限资源必须限定到指定 Bucket 的 `media/portrait/`、`media/audio/`、`media/video/` 前缀，仅授予 `PutObject`、`GetObject`、`DeleteObject`；不要授予全 Bucket 或全账号管理权限。

在 Bucket 配置最长 24 小时的临时媒体生命周期规则，作为应用清理失败的兜底。人物肖像是管理员配置的持久对象，应放在独立前缀并排除该临时规则。后台“私有 OSS”表单填写 region、Endpoint、Bucket，并在加密管理员 UI 输入 RAM 凭据；不要写入 `.env`。

对象始终保持私有。应用按需创建最长 15 分钟的签名 URL 给上游或播放器，数据库和日志只保存对象键。音频设为 1 小时、视频设为 23 小时到期，为 24 小时上限留出清理余量。运行时每 15 分钟尝试删除到期对象，失败会在 lease 过期后重试；若网络或凭据长期不可用，应用无法承诺已物理删除，因此 Bucket 生命周期是必要的独立兜底。

## 2. 人物肖像和 EMO 输入

管理端肖像上传只接受 JPEG/PNG、最大 5 MiB，且 `portraitWidth` / `portraitHeight` 每边必须在 400–7000 像素。EMO 肖像 URL 和音频 URL 必须是 HTTPS，不能使用 HTTP 或 Windows 本地路径；音频最大 15 MiB、最长 60 秒，由当前 Qwen TTS 生成并通过私有 OSS 短期签名 URL 传入。这些是应用的本地上限；阿里控制台可能更严格，真实调试前仍要核对当前地域和模型规格。

新版肖像记录不可变 `portraitWidth` 和 `portraitHeight`。旧画像缺少尺寸元数据时，必须重新上传或重新保存；仅修改数据库文字说明不能补齐可信尺寸。

## 3. 灵眸播报模板

在灵眸控制台创建并发布灵眸播报模板，取得当前模板 ID。列出模板要求的变量名及类型，在面试官配置中逐项建立变量映射，例如音频 URL、人物图片 URL、播报文本或模板实际要求的其他字段。不要把其他产品的项目字段当作播报模板 ID。

保存前核对：模板属于当前账号/地域、已发布可调用、变量映射名称与大小写完全一致、音频和图片变量接收 HTTPS 签名 URL、输出为应用支持的视频格式。

## 4. 三种调试模式与竞速

- `AUTO_RACE`：预设题灵眸优先，动态追问灵眸与 EMO 并发；
- `LINGMOU_ONLY`：只验证灵眸；
- `EMO_ONLY`：只验证 EMO。

两路可以共享同一个面试官，也可以配置为两位面试官。动态任务对灵眸和 EMO 两路立即各提交一次，不会等到第 3 秒才提交 EMO；第 3 秒和 6 秒轮询灵眸，第 8 秒轮询 EMO 并截止。8 秒仍无成功视频时立即使用本地头像与 Qwen TTS，迟到视频不得抢占播放。

## 5. 诊断费用和顺序

配置级诊断只读取并校验本地配置，是免费的。真实诊断可能产生费用，管理员必须勾选“确认付费诊断”后才能执行。不得把付费诊断放进启动、健康检查、定时监控或 CI。

人工真实调试顺序：

1. OSS 上传、签名读取和删除；
2. `LINGMOU_ONLY` 极短播报；
3. `EMO_ONLY` 极短视频；
4. `AUTO_RACE` 动态追问；
5. 强制 8 秒本地降级；
6. 到期媒体清理。

记录管理员页面展示的安全码、脱敏 trace ID、耗时和计费操作数；不要复制永久凭据、完整签名 URL、原始供应商响应、肖像或音频到工单/聊天。

## 6. Windows、Linux 与 Docker

Windows 本地调试：

```powershell
npm.cmd ci
npx.cmd prisma migrate deploy
npm.cmd run build
npm.cmd run dev
```

Linux 使用同一 `package-lock.json`：`npm ci`、`npx prisma migrate deploy`、`npm run build`、`npm run start`。首次访问仍通过 `/setup` 初始化超级管理员。

Docker 健康检查只访问 `/api/health`，不得触发付费诊断。若使用 Docker，验证后彻底关闭：

`docker desktop stop` is Windows Docker Desktop only and stops all local Desktop workloads; on Linux run only `docker compose down --remove-orphans` because a native Docker daemon does not support the Desktop command.

```powershell
docker compose down --remove-orphans
docker desktop stop
```
