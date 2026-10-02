# game-world

基于 [webcityim/game-world](https://github.com/webcityim/game-world) 的 3D 网页世界。
技术栈:**yarn + Vite + TypeScript + three.js `WebGPURenderer`**(不支持 WebGPU 的浏览器自动回落到 WebGL2)。

## 快速开始

```bash
corepack enable
yarn install
yarn dev        # http://localhost:5173
yarn build      # 产物在 dist/
yarn typecheck
```

调试参数(URL query):`?radius=6371000`(行星半径,米)、`?exag=2.5`(地形垂直夸张)、`?seed=123`(地形种子)。

## 操作

| 输入 | 动作 |
| --- | --- |
| 手柄左摇杆 / 右摇杆 | 移动 / 视角 |
| RT / LT | 上升 / 下降 |
| RB / LB | 加速 / 减速 |
| Y 或十字键右 / 十字键左 | 下一个 / 上一个书签 |
| 鼠标拖动 / WASD / Space,C / Shift / Z / 滚轮 | 视角 / 移动 / 升降 / 加速 / 减速 / 调速 |
| 数字键 1-6 | 直接传送到书签(轨道、商铺广场、4 个奇观) |

## 结构

```
src/
  config.ts            全局常量(行星半径、LOD 参数、商铺激活距离...)
  main.ts              渲染器、场景、主循环、HUD
  controls/
    input.ts           键鼠 + Gamepad API
    fly.ts             球面自由飞行相机("上"= 脚下行星法线)
  world/
    noise.ts           带种子的 3D 梯度噪声
    terrain.ts         海拔函数(大陆 / 山脉 / 丘陵 / 河谷)、地表配色、压平区域
    planet.ts          立方体球面 + 四叉树 LOD、水面、裙边、浮动原点
    anchor.ts          挂在行星表面的锚点 + 选址(pickSites)
    wonders.ts         奇观:世界树、浮空岛、水晶尖塔、天环
  shops/
    htmlTexture.ts     HTML in Canvas(原生 drawElementImage / SVG foreignObject 兜底)
    pages.ts           商铺页面(真实 HTML+CSS)
    shop.ts            商铺建筑、广场、按距离开关页面
```

### 大尺度渲染

- 位置全部用 float64(JS number)保存;每个地形块的顶点相对块中心存储,
  渲染时相机固定在原点、整个世界减去相机位置(**浮动原点**),所以 6371 km 半径下地面也不抖动。
- `logarithmicDepthBuffer` 解决 0.5 m ~ 3×10^8 m 的深度范围。
- 四叉树按相机距离细分(最大层级 15,块宽约 300 m、顶点间距约 10 m),
  子块没生成完之前继续画父块;每帧只花固定的 CPU 时间预算生成块,地平线以外的块直接剔除。

### HTML in Canvas

商铺的墙上有一块"屏幕",内容是真实的 HTML 页面:

- 支持原生 `layoutsubtree` + `drawElementImage` 的浏览器(Chrome 实验特性)走原生路径,DOM 变化自动重绘。
- 其他浏览器自动用 SVG `foreignObject` 兜底(静态快照,每秒刷新一次)。
- 距离 > 220 m 时页面被关闭(原生路径把 canvas 从 DOM 摘掉、停止重绘),只显示熄灭的屏幕;< 140 m 时重新打开。

> 该提案的 API 仍在演进,`htmlTexture.ts` 里的调用都做了特性检测,接口变动时只需要改这一个文件。

## 部署

`.github/workflows/upload.yaml` 参考 [calcit-lang/respo-calcit-workflow](https://github.com/calcit-lang/respo-calcit-workflow):

1. 构建时设置 `VITE_BASE_URL=https://cos-sh.tiye.me/<owner>/<repo>/`(PR 为 `.../pr/`),`vite.config.ts` 读取它作为 `base`
2. 静态资源上传到腾讯云 COS
3. push 到 `main` 时 rsync 到服务器;同仓库的 PR 发布到 `/pr/` 预览目录

需要配置的仓库 Secrets:`COS_BUCKET`、`COS_SECRET_ID`、`COS_SECRET_KEY`、`rsync_private_key`。

仓库初期没有 `yarn.lock`,CI 会自动用 `--no-immutable` 安装;本地跑过一次 `yarn install` 并提交 `yarn.lock` 后,CI 会切换为 `--immutable`。

## 路线图

- [ ] 地形生成搬到 Web Worker,取消每帧预算限制
- [ ] 河流:用流量累积烘焙真正流向大海的河网(当前是低地河谷)
- [ ] 商铺页面交互(射线 → 页面坐标 → 转发点击)
- [ ] 大气散射、云层、海浪(TSL / 计算着色器)
- [ ] 按"提瓦特"比例确定行星半径与大陆布局
