# PostgreSQL + Neo4j 部署指南

## 架构

- **PostgreSQL** (pgvector) — KV / 向量 / 文档状态存储
- **Neo4j** — 图存储
- **LightRAG** — 宿主机直跑，连接本地 PostgreSQL + Neo4j

## 1. 启动数据库容器（Docker）

```bash
cd /workspace/web/LightRAG

# 只启动 postgres + neo4j 容器
docker-compose -f docker-compose-pg-neo4j.yml up -d postgres neo4j

# 查看状态
docker-compose -f docker-compose-pg-neo4j.yml ps
```

容器端口映射：
| 服务 | host 端口 | 容器内端口 |
|------|-----------|------------|
| PostgreSQL | 5455 | 5432 |
| Neo4j Bolt | 7687 | 7687 |
| Neo4j Browser | 7474 | 7474 |

## 2. 编译 LightRAG（宿主机）

```bash
# 安装 uv（如未安装）
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

# 安装依赖（含 api + offline-storage extras）
cd /workspace/web/LightRAG
uv sync --all-extras

# 编辑安装 lightrag
uv pip install -e ".[api,offline-storage]"

# 验证
uv run python -c "import lightrag; print('OK')"
```

## 3. 配置 .env

关键配置项：

```bash
# 存储后端
LIGHTRAG_KV_STORAGE=PGKVStorage
LIGHTRAG_DOC_STATUS_STORAGE=PGDocStatusStorage
LIGHTRAG_GRAPH_STORAGE=Neo4JStorage
LIGHTRAG_VECTOR_STORAGE=PGVectorStorage

# PostgreSQL（指向宿主机映射端口）
POSTGRES_HOST=localhost
POSTGRES_PORT=5455
POSTGRES_USER=rag
POSTGRES_PASSWORD=rag
POSTGRES_DATABASE=rag

# Neo4j（指向宿主机）
NEO4J_URI=neo4j://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=neo4j12345
NEO4J_DATABASE=neo4j

# LightRAG Server
HOST=0.0.0.0
PORT=5173

# LLM（填入实际 API key）
LLM_BINDING=openai
LLM_BINDING_HOST=https://api.openai.com/v1
LLM_BINDING_API_KEY=sk-xxx
LLM_MODEL=gpt-4o-mini

# Embedding
EMBEDDING_BINDING=openai
EMBEDDING_BINDING_HOST=https://api.openai.com/v1
EMBEDDING_BINDING_API_KEY=sk-xxx
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIM=1536
EMBEDDING_TOKEN_LIMIT=8192
```

## 4. 启动 LightRAG

```bash
cd /workspace/web/LightRAG
source .venv/bin/activate
lightrag-server
```

访问 `http://localhost:5173`

## 5. Rerank 配置（可选）

`RERANK_BINDING` 支持的值：

| 值 | 说明 |
|----|------|
| `null` | 不启用 rerank（默认） |
| `cohere` | Cohere / vLLM 部署的 reranker（Cohere 兼容 API） |
| `jina` | Jina AI reranker |
| `aliyun` | 阿里云 Dashscope（gte-rerank 系列，嵌套格式） |

相关配置项：

```bash
RERANK_BINDING=null
# RERANK_MODEL=BAAI/bge-reranker-v2-m3
# RERANK_BINDING_HOST=http://localhost:8000/rerank
# RERANK_BINDING_API_KEY=your_rerank_api_key_here
# MIN_RERANK_SCORE=0.0
# RERANK_BY_DEFAULT=True
# MAX_ASYNC_RERANK=4
# RERANK_TIMEOUT=30
# RERANK_ENABLE_CHUNKING=true
# RERANK_MAX_TOKENS_PER_DOC=480
```

各 provider 示例：

### Cohere
```bash
RERANK_BINDING=cohere
RERANK_MODEL=rerank-v3.5
RERANK_BINDING_HOST=https://api.cohere.com/v2/rerank
RERANK_BINDING_API_KEY=your_key
```

### vLLM 本地部署（用 cohere binding）
```bash
RERANK_BINDING=cohere
RERANK_MODEL=BAAI/bge-reranker-v2-m3
RERANK_BINDING_HOST=http://localhost:8000/rerank
```

### 阿里云 Dashscope (gte-rerank)
```bash
RERANK_BINDING=aliyun
RERANK_MODEL=gte-rerank-v2
RERANK_BINDING_HOST=https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank
RERANK_BINDING_API_KEY=your_key
```

### 阿里云 qwen3-rerank（Cohere 兼容格式）
```bash
RERANK_BINDING=cohere
RERANK_MODEL=qwen3-rerank
RERANK_BINDING_HOST=https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks
RERANK_BINDING_API_KEY=your_key
```

### Jina AI
```bash
RERANK_BINDING=jina
RERANK_MODEL=jina-reranker-v2-base-multilingual
RERANK_BINDING_HOST=https://api.jina.ai/v1/rerank
RERANK_BINDING_API_KEY=your_key
```

## 6. 常用维护命令

```bash
# 停止数据库容器
docker-compose -f docker-compose-pg-neo4j.yml down

# 停止并删除数据
docker-compose -f docker-compose-pg-neo4j.yml down -v

# 查看 LightRAG 日志
lightrag-server  # 前台运行，直接看日志

# Neo4j Browser
# http://localhost:7474 (neo4j / neo4j12345)
```
