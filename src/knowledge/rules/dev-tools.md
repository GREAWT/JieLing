# 开发工具指纹规则

格式说明：每条规则以 `## 规则id` 开头，随后是 `- 字段: 值` 列表。
匹配字段（可组合，字段之间是「且」，竖线分隔的列表内部是「或」）：
name（目录/文件精确名）、glob（名称通配）、pathContains（路径子串）、pathRegex（路径正则，单条）、
kind（directory/file/any，默认 directory）、empty（true 表示仅匹配空目录）、
markers（内部标志性条目通配，竖线分隔）、requireMarkers（true 表示 markers 必须命中）、
siblings（同级条目通配）、requireSiblings（true 表示 siblings 必须命中）。

## node-modules
- name: node_modules
- markers: .package-lock.json|.bin
- owner: Node.js
- ownerKind: dev_tool
- purpose: 前端/Node 项目下载的第三方依赖包目录
- verdict: safe_delete
- confidence: 0.95
- rebuildable: true
- reason: 通常为项目依赖目录，可通过包管理器重新安装；隔离前请确认项目未运行，并保留package.json与锁文件。
- consequence: 隔离后项目可能暂时无法运行。重新安装依赖需要网络与相应包管理器，版本与构建结果不保证与之前完全一致。
- revival: none

## pnpm-store
- name: .pnpm-store
- markers: v3|v10|files
- owner: pnpm
- ownerKind: dev_tool
- purpose: pnpm 包管理器的全局内容寻址仓库，所有项目共享的依赖硬链接来源
- verdict: safe_delete
- confidence: 0.9
- rebuildable: true
- reason: 这是 pnpm 下载依赖时的本地仓库，全部内容都能从 npm 仓库重新拉取，不含任何个人创作。
- consequence: 删掉后已有项目的 node_modules 硬链接可能失效，下次 pnpm install 会重新下载依赖，耗时取决于网速。
- revival: none

## pycache
- name: __pycache__
- markers: *.pyc
- owner: Python
- ownerKind: dev_tool
- purpose: Python 解释器自动生成的字节码缓存，用来加快模块导入
- verdict: safe_delete
- confidence: 0.97
- rebuildable: true
- reason: 里面全是 .pyc 编译缓存，由旁边的 .py 源码自动生成，删掉不损失任何源代码。
- consequence: 下次运行 Python 程序时会自动重新生成，首次导入模块稍微慢一点点，用户基本无感。
- revival: none

## pytest-cache
- name: .pytest_cache
- markers: CACHEDIR.TAG|v
- owner: pytest
- ownerKind: dev_tool
- purpose: pytest 测试框架的缓存，记录上次失败的用例等信息
- verdict: safe_delete
- confidence: 0.92
- rebuildable: true
- reason: 只存测试运行的临时状态（比如「上次哪些用例失败了」），不是测试代码本身。
- consequence: 删掉后 pytest 的 --lf（只跑上次失败用例）等便利功能暂时失效，跑一次测试就会重建。
- revival: none

## mypy-cache
- name: .mypy_cache
- markers: CACHEDIR.TAG|.gitignore
- owner: mypy
- ownerKind: dev_tool
- purpose: Python 类型检查工具 mypy 的增量分析缓存
- verdict: safe_delete
- confidence: 0.92
- rebuildable: true
- reason: 缓存的是类型检查结果，源码和配置都不在这里，删掉只是让下次检查从头算一遍。
- consequence: 下次运行 mypy 会慢一些（全量检查），之后自动重建缓存，不影响任何代码。
- revival: none

## gradle-caches
- pathRegex: /\.gradle/caches$
- markers: modules-2|jars-9|transforms-3|build-cache-1
- owner: Gradle
- ownerKind: dev_tool
- purpose: Gradle 构建工具的全局依赖与构建缓存，安卓/Java 项目常用
- verdict: safe_delete
- confidence: 0.9
- rebuildable: true
- reason: 里面是从 Maven 仓库下载的 jar 包和构建中间产物，往往有几个 GB，全部可以重新下载或重新编译。
- consequence: 删掉后下一次 Gradle 构建会重新下载依赖并全量编译，第一次明显变慢，之后恢复正常。注意别误删同级的 gradle.properties 配置。
- revival: none

## m2-repository
- pathRegex: /\.m2/repository$
- owner: Maven
- ownerKind: dev_tool
- purpose: Maven 的本地依赖仓库，存放下载过的 jar 包
- verdict: safe_delete
- confidence: 0.92
- rebuildable: true
- reason: 全是构建时从中央仓库下载的依赖包，不含你的源码。settings.xml 配置在 .m2 根目录而不在 repository 里，删这个子目录是安全的。
- consequence: 下次 mvn 构建会重新下载用到的依赖，联网环境下可完整恢复；离线环境请先确认再删。
- revival: none

## nuget-packages
- pathRegex: /\.nuget/packages$
- owner: NuGet
- ownerKind: dev_tool
- purpose: .NET 的 NuGet 包全局缓存
- verdict: safe_delete
- confidence: 0.9
- rebuildable: true
- reason: 存放从 nuget.org 下载的依赖包，供所有 .NET 项目共享，内容都能重新拉取。
- consequence: 下次 dotnet restore / Visual Studio 还原包时重新下载，首次构建变慢，不影响项目源码。
- revival: none

## rust-maven-target
- name: target
- markers: CACHEDIR.TAG|.rustc_info.json|debug|release|classes|maven-status|generated-sources|surefire-reports
- requireMarkers: true
- owner: Rust / Maven
- ownerKind: dev_tool
- purpose: Rust（cargo）或 Java（Maven）项目的编译输出目录
- verdict: safe_delete
- confidence: 0.85
- rebuildable: true
- reason: 目录里有 debug/release 或 classes 等编译产物特征，说明这是构建输出，不是源码。源码在旁边的 src 里。
- consequence: 删掉后 cargo build / mvn package 会全量重新编译，Rust 大项目可能要几分钟到几十分钟，产物可完整再生。
- revival: none

## dotnet-obj
- name: obj
- markers: project.assets.json|Debug|Release|*.csproj.nuget.*|*.fsproj.nuget.*
- requireMarkers: true
- owner: .NET SDK
- ownerKind: dev_tool
- purpose: C#/.NET 项目的中间编译目录（还原结果、临时编译产物）
- verdict: safe_delete
- confidence: 0.85
- rebuildable: true
- reason: 有 project.assets.json 等特征文件，确认是 .NET 构建中间目录，内容全部由构建过程生成。
- consequence: 下次构建自动重建，首次编译稍慢；不影响源码和最终发布文件。
- revival: none

## web-dist
- name: dist
- pathRegex: ^(?!.*node_modules/)
- siblings: package.json|vite.config.*|webpack.config.*|rollup.config.*|tsconfig.json|Cargo.toml|pom.xml|build.gradle|pyproject.toml|setup.py
- requireSiblings: true
- owner: 前端/构建工具
- ownerKind: dev_tool
- purpose: 项目打包输出目录（压缩后的 js/css/html 等发布产物）
- verdict: safe_delete
- confidence: 0.85
- rebuildable: true
- reason: 同级存在 package.json 等项目配置，说明这是源码项目的打包产物，跑一次 build 命令就能重新生成。
- consequence: 删掉后需要重新执行 npm run build 等命令才能部署；如果这是你唯一一份发布包且源码已丢失，请先确认源码还在。
- revival: none

## cmake-gradle-build
- name: build
- markers: CMakeCache.txt|CMakeFiles|cmake_install.cmake|classes|generated|intermediates|outputs|maven-status|surefire-reports|test-results
- requireMarkers: true
- owner: CMake / Gradle
- ownerKind: dev_tool
- purpose: C++（CMake）或安卓/Java（Gradle）项目的构建输出目录
- verdict: safe_delete
- confidence: 0.8
- rebuildable: true
- reason: 内部有 CMakeCache.txt 或 classes/intermediates 等构建特征，确认是编译产物目录而非手工整理的资料夹。
- consequence: 删掉后重新构建即可恢复，C++ 大项目全量编译较耗时；不影响任何源代码。
- revival: none

## next-cache
- pathRegex: /\.next/cache$
- owner: Next.js
- ownerKind: dev_tool
- purpose: Next.js 框架的构建与图片优化缓存
- verdict: safe_delete
- confidence: 0.92
- rebuildable: true
- reason: 只存 webpack/图片优化等缓存，删掉不丢页面代码，Next.js 官方也认可清理这个目录。
- consequence: 下次 next dev / next build 会重新生成缓存，首次构建和图片加载稍慢。
- revival: none

## nuxt-build
- name: .nuxt
- markers: dist|components.d.ts|nuxt.json|tsconfig.json
- owner: Nuxt
- ownerKind: dev_tool
- purpose: Nuxt（Vue 框架）自动生成的构建中间目录
- verdict: safe_delete
- confidence: 0.88
- rebuildable: true
- reason: 整个目录由 Nuxt 根据 pages/、components/ 等源码自动生成，官方文档明确说它可以随时删除重建。
- consequence: 下次 nuxt dev / nuxt build 自动重建，首次启动稍慢，不丢任何源码。
- revival: none

## python-venv
- name: .venv|venv
- markers: pyvenv.cfg|Scripts|Lib|bin
- owner: Python
- ownerKind: dev_tool
- purpose: Python 虚拟环境，隔离安装的解释器副本和依赖包
- verdict: safe_delete
- confidence: 0.85
- rebuildable: true
- reason: 虚拟环境里是 Python 解释器副本和 pip 装的依赖，不是你的代码；有 pyvenv.cfg 等特征可以确认。
- consequence: 删掉后需要重新创建虚拟环境并安装依赖（python -m venv .venv 后 pip install -r requirements.txt）；如果依赖清单没保存，恢复会麻烦，删前确认有 requirements.txt 或 pyproject.toml。
- revival: none

## pypackages
- name: __pypackages__
- owner: Python (PEP 582)
- ownerKind: dev_tool
- purpose: PEP 582 提案的本地依赖目录（pdm 等工具使用）
- verdict: safe_delete
- confidence: 0.85
- rebuildable: true
- reason: 和 node_modules 类似，是项目本地安装的第三方依赖，可由依赖清单重新安装。
- consequence: 删掉后用 pdm install 等命令重新安装依赖即可，不影响源码。
- revival: none

## tox-envs
- name: .tox
- markers: log|dist|py*
- owner: tox
- ownerKind: dev_tool
- purpose: tox 自动化测试工具创建的多个虚拟环境
- verdict: safe_delete
- confidence: 0.88
- rebuildable: true
- reason: 里面是 tox 为跑测试临时建的一套套虚拟环境，全部可以重建。
- consequence: 下次运行 tox 会重新建环境并装依赖，耗时几分钟，不影响源码。
- revival: none

## coverage-report
- name: coverage|htmlcov|.nyc_output
- markers: lcov.info|coverage-final.json|lcov-report|index.html|status.json|*.lcov|cobertura.xml|jacoco.xml|processinfo
- requireMarkers: true
- owner: 测试覆盖率工具
- ownerKind: dev_tool
- purpose: 测试覆盖率报告（istanbul/coverage.py/jacoco 等生成）
- verdict: safe_delete
- confidence: 0.85
- rebuildable: true
- reason: 有 lcov.info、coverage-final.json 等特征，确认是覆盖率报告而非同名资料夹；报告跑一次测试就能重新生成。
- consequence: 删掉后历史覆盖率报告消失，重新跑测试即可再生；如果团队要留档某次报告，请先归档。
- revival: none

## turbo-cache
- name: .turbo
- markers: turbo-cache.jsonl|daemon
- owner: Turborepo
- ownerKind: dev_tool
- purpose: Turborepo  monorepo 构建工具的本地任务缓存
- verdict: safe_delete
- confidence: 0.88
- rebuildable: true
- reason: 缓存的是构建任务输出，用来跳过重复构建，删掉只是失去加速效果。
- consequence: 下次 turbo 构建会全量执行任务，变慢一些，之后缓存自动重建。
- revival: none

## parcel-cache
- name: .parcel-cache
- owner: Parcel
- ownerKind: dev_tool
- purpose: Parcel 打包工具的持久化缓存
- verdict: safe_delete
- confidence: 0.92
- rebuildable: true
- reason: 纯构建缓存，Parcel 官方设计就是可随时清空，源码不在这里。
- consequence: 下次构建稍慢（冷启动），之后自动重建，无任何数据损失。
- revival: none

## bower-components
- name: bower_components
- owner: Bower
- ownerKind: dev_tool
- purpose: 老牌前端包管理器 Bower 下载的依赖目录
- verdict: safe_delete
- confidence: 0.88
- rebuildable: true
- reason: 和 node_modules 同理，全是 bower.json 里声明的第三方库，可重新安装。Bower 已停止维护，这类目录多为老项目遗留。
- consequence: 删掉后老项目需 bower install 恢复；若项目已迁移到 npm，这个目录就是纯遗留垃圾。
- revival: none

## npm-cache
- name: .npm
- markers: _cacache|_logs|_npx|_locks
- owner: npm
- ownerKind: dev_tool
- purpose: npm 的全局下载缓存与日志
- verdict: safe_delete
- confidence: 0.88
- rebuildable: true
- reason: _cacache 里是下载过的包压缩包副本，_logs 是安装日志，都能再生或无关紧要；npm 官方提供 npm cache clean 就是清这里。
- consequence: 删掉后下次安装依赖会重新走网络下载，稍慢；不影响任何已装好的项目。
- revival: none

## yarn-cache
- pathRegex: /\.yarn/(berry/)?cache$
- owner: Yarn
- ownerKind: dev_tool
- purpose: Yarn 的离线依赖缓存（zip 包镜像）
- verdict: safe_delete
- confidence: 0.88
- rebuildable: true
- reason: 存放下载过的依赖 zip 包，用于离线安装加速，内容可从 registry 重新获取。
- consequence: 删掉后 yarn install 需重新下载依赖；若项目依赖「零安装」离线模式，请先确认网络可用。
- revival: none

## cocoapods-cache
- pathRegex: /Library/Caches/CocoaPods$
- owner: CocoaPods
- ownerKind: dev_tool
- purpose: iOS/macOS 依赖管理工具 CocoaPods 的下载缓存
- verdict: safe_delete
- confidence: 0.9
- rebuildable: true
- reason: 缓存的是 pod 依赖包副本，pod install 时会按需重新下载。
- consequence: 下次 pod install 重新下载依赖，耗时增加，不影响工程源码。
- revival: none

## xcode-deriveddata
- name: DerivedData
- pathContains: Library/Developer/Xcode
- owner: Xcode
- ownerKind: dev_tool
- purpose: Xcode 的编译产物、索引和日志目录
- verdict: safe_delete
- confidence: 0.92
- rebuildable: true
- reason: 全是编译中间产物和代码索引，iOS 开发者经常靠清理它来解决构建怪问题，官方认可可删。
- consequence: 删掉后 Xcode 重新编译和建索引，大项目首次明显变慢；不丢源码，但会丢失断点等少量工作区状态。
- revival: none

## ios-pods
- name: Pods
- siblings: Podfile|*.xcodeproj|*.xcworkspace|Podfile.lock
- requireSiblings: true
- owner: CocoaPods
- ownerKind: dev_tool
- purpose: iOS 工程里 CocoaPods 安装的第三方依赖源码
- verdict: safe_delete
- confidence: 0.82
- rebuildable: true
- reason: 同级有 Podfile / xcodeproj，确认这是 iOS 工程的依赖目录，内容由 pod install 生成。
- consequence: 删掉后执行 pod install 恢复；Podfile.lock 还在就能装回完全一致的版本。
- revival: none

## vs-workspace-state
- name: .vs
- markers: v15|v16|v17|config
- owner: Visual Studio
- ownerKind: dev_tool
- purpose: Visual Studio 的解决方案级本地状态（窗口布局、IntelliSense 数据库等）
- verdict: safe_delete
- confidence: 0.8
- rebuildable: true
- reason: 存的是 IDE 个人工作状态和索引数据库，不是代码；VS 关闭后删除是社区常见排障手段。
- consequence: 删掉后重新打开解决方案会重建索引，窗口布局、打开的文件列表等回到默认；请先关闭 Visual Studio 再删。
- revival: none

## generic-dot-cache
- name: .cache
- owner: 各类开发工具
- ownerKind: cache
- purpose: 用户级通用缓存目录（pip、huggingface、字体工具等都可能写这里）
- verdict: needs_review
- confidence: 0.6
- rebuildable: true
- reason: 大多数内容是可再生缓存，但也可能躺着几个 GB 的 AI 模型文件（如 huggingface 下载），重新下载很费时间流量。
- consequence: 删掉后相关工具首次运行变慢或需重新下载资源；建议先看看里面哪个子目录最大再决定。
- revival: none

## git-dir
- name: .git
- owner: Git
- ownerKind: dev_tool
- purpose: Git 版本仓库本体：全部提交历史、分支、配置
- verdict: keep_locked
- confidence: 0.99
- rebuildable: false
- reason: 这是整个项目的版本历史数据库，删了它，项目就变成一堆没有历史的普通文件，且无法找回未推送的提交。
- consequence: 所有提交记录、分支、stash 永久丢失；如果远端没有备份，等于丢掉了项目的全部开发历史。绝对不能删。
- revival: none

## source-repo-root
- markers: .git
- requireMarkers: true
- owner: 源码仓库
- ownerKind: dev_tool
- purpose: 包含 .git 的目录是一个完整的代码仓库根目录
- verdict: keep_locked
- confidence: 0.95
- rebuildable: false
- reason: 内部发现 .git，说明这是有人在做版本管理的源码项目，里面是劳动成果而不是缓存。
- consequence: 删除会丢失源码与全部版本历史；即使代码已推送远端，本地未提交的改动也会消失。请整体保留。
- revival: none