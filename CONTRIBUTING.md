# 本项目贡献指南

## 贡献代码
本项目没有任何依赖，并且在服务端和浏览器均可运行，请确保没有使用DOM API！

本项目是KPA的子项目，因此在贡献时，确保您的代码符合KPA的理念。

如果您使用VSCode，请安装ESLint插件。仓库中已经配置好ESLint规则。

### 代码风格
- 缩进使用4个空格
- 函数、变量、参数命名使用小驼峰，类命名使用大驼峰，枚举成员命名不死板，可以用小驼峰，也可以用常量命名的样式，以好用为目的
- 不强制使用分号，但尽量使用
- 引号尽量用双引号

#### 操作的命名
结构为：`操作主题[操作对象]动词原形[宾语]Operation`（宾语可能和操作对象是同一个东西）

例如：
- `EventNodeValueChangeOperation`
  - 操作是关于节点的
  - 操作对象是节点的值
  - 操作的行为是改变
- `EventNodeInsertOperation`
  - 操作是关于节点的，对象也是节点
  - 操作的行为是（把节点）插入（序列）

尽管如此，有时也可以不遵循此规则，比如`EncapsuleOperation`。

#### 常用缩写
尽管不提倡大量使用，代码中还是可以使用一些缩写，常用缩写如下表：
| 缩写 | 含义 |
| --- | --- |
| `pos` | `position` |
| `FP` | `floorPosition` |
| `ens` | `EventNodeSequence` |
| `nn` | `NoteNode` |
| `nnn` | `NoteNodeNode` |
| `env` | `Environment` |

#### 变量命名
除了JavaScript通用的命名规则，还有以下命名方法：
- `beats`表示拍数，类型为`number`，KPA所有项目统一，使用复数。
- `time`表示事件，为浮点数三元组。亦可用`beaT`表示，但使用极少。



