# 中台接入说明

v4 在线考试系统接入中台时，需要在中台账号系统里新增一个插件：

```js
assess: { path: "/v4/assess/", label: "在线考试系统" }
```

默认能力：

```js
assess: ["view", "take", "grade", "manage"]
```

账号管理页需要增加一个勾选项：

```html
<label><input type="checkbox" name="plugins" value="assess" /> v4 在线考试系统</label>
```

前端脚本里的插件标签需要增加：

```js
assess: "v4 在线考试系统"
```

管理员账号默认拥有全部插件权限，所以中台更新后，管理员会自动包含 v4。普通账号需要管理员手动勾选 v4 权限。
