# 10.31.26.22 部署与维护

访问入口：<http://10.31.26.22:8766/>（校园内网）。8765 已被其他项目使用。

2026-11-26 学生导航更新：底部改为“实验 / 记录 / 我的”，个人页展示账号、课程和当前小组；结论、提交和反馈从实验页内进入。资源版本为 `teaching05`。本轮两组前端运行检查在本地和服务器通过，健康接口及四份线上资源校验通过，未重新执行后端全量验收，浏览器截图核对尚未完成。

第一阶段现已提供多课程、多学期、实验内容版本、教学班与名单、注册与邀请码、自主及教师分组、任务预览发布和独立小组实验。数据库升级为版本 2。当前版本通过 26 项后端验收、两组前端运行检查及 28 项在线教学流程检查，实际浏览器视觉验收仍待完成。

迁移前已保留 `shared/backups/pre-teaching-final-<release>.sqlite3`，并用数据库副本连续演练两次，校验旧表原字段与原值保持一致。运行时数据仍在原 `shared/data/`。数据库已升级后，如需回退，应同时评估旧代码与迁移前快照，并先保留新版本产生的数据；不能只切换代码后假设新教学管理关系仍然可用。

2026-11-25 部署验证通过：服务器上 13 项后端验收、前端运行检查与依赖一致性检查通过；运行服务的 19 项在线流程检查通过；从部署电脑验证页面、资源、3 个试用账号及登录退出通过。临时测试课程和记录已清理，SQLite 完整性为 `ok`。此轮未进行浏览器视觉验收。部署信息见 `deployment.json`，已安装的精确依赖版本见 `requirements-server.lock`。

当日 UI02 更新恢复已确认 v0.2 的页面布局和组件样式。服务器页面加载带 `?v=ui02` 的资源，三份前端资源的校验值与源码一致；刷新页面即可加载。更新前数据库已备份到 `shared/backups/pre-ui02-20261125121852.sqlite3`，沿用原有持久化目录。后台与前端运行验收、19 项在线流程检查通过；浏览器控制超时，尚未完成实际截图对照。

部署用户为 `zlzhou`，根目录为 `/home/zlzhou/apps/ai-lab-assistant`。使用独立 Python 虚拟环境和用户级 systemd 服务；用户已启用 linger，退出 SSH 后服务继续运行，并在服务器启动时自动启动。

```text
ai-lab-assistant/
  .venv/                 独立 Python 依赖
  releases/<UTC时间戳>/  版本代码
  current                指向正在运行的版本
  shared/service.env     服务地址、持久化路径、可选模型配置
  shared/data/           SQLite 与照片
  shared/backups/        手动备份存放位置
```

查看状态、日志或重启：

```sh
ssh zlzhou@10.31.26.22
systemctl --user status ai-lab-assistant.service
journalctl --user -u ai-lab-assistant.service -n 80 --no-pager
systemctl --user restart ai-lab-assistant.service
curl --fail http://10.31.26.22:8766/api/health
```

停止 / 启动：

```sh
systemctl --user stop ai-lab-assistant.service
systemctl --user start ai-lab-assistant.service
```

试用账号与本地版相同：`teacher`、`student1`、`student2`，密码均为 `Lab2026!`。两个学生账号分别属于两个小组。同一浏览器共享登录，需要同时体验两端时请使用不同浏览器或无痕窗口。

模型配置写入服务器的 `shared/service.env`。以阿里云百炼北京地域的 `qwen-plus` 文字助教为例：

```ini
LAB_AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LAB_AI_MODEL=qwen-plus
LAB_AI_KEY=<在服务器上填写业务空间的实际 API Key>
```

按[阿里云百炼兼容接口文档](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)使用与密钥所属地域一致的地址，优先采用业务空间专属域名。`LAB_AI_BASE_URL` 填到 `/compatible-mode/v1`。密钥只存服务器、文件权限设为 `600`。

写入配置后，在服务器用和正式助教相同的客户端先做联通测试。下列命令只使用一条示例文本，不读取实验数据库，也不显示密钥或服务方响应正文：

```sh
systemd-run --user --wait --pipe --collect \
  -p EnvironmentFile=/home/zlzhou/apps/ai-lab-assistant/shared/service.env \
  /home/zlzhou/apps/ai-lab-assistant/.venv/bin/python \
  /home/zlzhou/apps/ai-lab-assistant/current/model_client.py
```

测试成功后重启 `ai-lab-assistant.service` 以读取配置，并用试用实验验证学生提示和教师草稿。文字模型不可用时，助教仍提供规则建议。

为图片和视频启用视觉模型时，在同一配置文件增加 `LAB_AI_VISION_MODEL=qwen3-vl-plus`。视觉调用复用 `LAB_AI_BASE_URL` 和 `LAB_AI_KEY`，百炼业务空间需要同时有权调用两个模型。参见[百炼密钥权限说明](https://help.aliyun.com/zh/model-studio/permission-management-overview)和[视觉理解接口说明](https://help.aliyun.com/zh/model-studio/vision)。

进入实验或教师的本组实验过程，点击「AI 看图／视频」。图片支持 JPEG、PNG（4 MB），视频支持 MP4（10 MB，建议截取 2 至 30 秒）。实验记录中已保存的照片也可发起 AI 分析。视觉请求仅发送所选素材、核对问题和必要的实验说明。结果供人工核对，不自动保存为测量、报告或评分。新上传作为临时分析素材处理，需存档的照片可另用「加照片」。

服务器使用独立数据目录，代码更新不会覆盖数据库与照片。现有本地数据库没有实验记录，因此服务器从空白实验过程开始；不迁移本地登录会话。

防火墙仅新增指向本机 8766/TCP、来源为 `10.31.0.0/16` 和 `10.26.0.0/16` 的访问规则。已有项目、端口和服务保持原状。

后续更新应上传到新的 release 目录、先在临时数据库运行验收，再切换 `current` 并重启本服务。保留旧目录用于回滚；数据库变更需要先备份与兼容性检查。

重新安装同一环境时，可使用 `python -m pip install -r requirements.txt -c deploy/requirements-server.lock`。对已运行服务执行在线验收时，在服务器使用以下命令；脚本会创建独立的临时课程，结束后仅删除自己创建的数据：

```sh
~/apps/ai-lab-assistant/.venv/bin/python \
  ~/apps/ai-lab-assistant/current/deploy/check_live.py \
  --base-url http://10.31.26.22:8766 \
  --data-dir /home/zlzhou/apps/ai-lab-assistant/shared/data
```

前端支持内网 HTTP：操作编号使用 `crypto.getRandomValues`，重试索引对不可用的 `crypto.subtle` 有兼容路径，权限与载荷校验仍由后端处理。相关兼容检查包括在前端测试中移除 `crypto.randomUUID` 与 `crypto.subtle` 后完成重试流程。

当前教学流程在线验收命令：

```sh
~/apps/ai-lab-assistant/.venv/bin/python \
  ~/apps/ai-lab-assistant/current/deploy/check_teaching_live.py \
  --base-url http://10.31.26.22:8766 \
  --data-dir /home/zlzhou/apps/ai-lab-assistant/shared/data
```

该脚本使用独立的临时教师与学生，验证建课、开班、选课、发布、组队、讲义上传和替换、测量、反馈、归档及跨学期复制；退出时清理自身创建的账户、课程与记录。
