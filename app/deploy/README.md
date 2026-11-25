# 10.31.26.22 部署与维护

访问入口：<http://10.31.26.22:8766/>（校园内网）。8765 已被其他项目使用。

2026-11-25 部署验证通过：服务器上 13 项后端验收、前端运行检查与依赖一致性检查通过；运行服务的 19 项在线流程检查通过；从部署电脑验证页面、资源、3 个试用账号及登录退出通过。临时测试课程和记录已清理，SQLite 完整性为 `ok`。此轮未进行浏览器视觉验收。部署信息见 `deployment.json`，已安装的精确依赖版本见 `requirements-server.lock`。

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

模型配置写入 `shared/service.env` 中的 `LAB_AI_BASE_URL`、`LAB_AI_MODEL`、`LAB_AI_KEY`，然后重启服务。无需改前端代码，不能将真实密钥写入版本文件。本次部署未配置外部模型，保持规则助教模式。

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
