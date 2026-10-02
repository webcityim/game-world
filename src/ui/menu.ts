// 悬浮菜单:可折叠,点击按钮飞向预设位置。

export interface MenuItem {
  label: string;
  group: string;
  onClick: () => void;
}

export interface MenuHandle {
  setActive(label: string | null): void;
}

const GROUP_ICONS: Record<string, string> = { 轨道: "◎", 城市: "▦", 奇观: "✦", 工具: "⚙" };

/** 创建右上角的悬浮菜单。折叠状态写入 localStorage(不可用时静默忽略)。 */
export function createMenu(items: MenuItem[], tools: { label: string; onClick: () => void }[]): MenuHandle {
  const root = document.getElementById("menu")!;
  let collapsed = false;
  try {
    collapsed = localStorage.getItem("menu-collapsed") === "1";
  } catch {
    /* ignore */
  }

  root.innerHTML = "";
  const head = document.createElement("button");
  head.className = "menu-head";
  head.type = "button";
  head.innerHTML = `<span class="menu-title">传送 · Teleport</span><span class="menu-caret">▾</span>`;
  root.appendChild(head);

  const body = document.createElement("div");
  body.className = "menu-body";
  root.appendChild(body);

  const buttons = new Map<string, HTMLButtonElement>();
  const groups = new Map<string, HTMLElement>();
  const groupOf = (name: string) => {
    let g = groups.get(name);
    if (!g) {
      const wrap = document.createElement("section");
      wrap.className = "menu-group";
      const h = document.createElement("h4");
      h.textContent = `${GROUP_ICONS[name] ?? "•"} ${name}`;
      wrap.appendChild(h);
      body.appendChild(wrap);
      groups.set(name, wrap);
      g = wrap;
    }
    return g;
  };

  for (const it of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-item";
    b.textContent = it.label;
    b.addEventListener("click", () => {
      it.onClick();
      b.blur(); // 避免空格 / 回车再次触发按钮
    });
    groupOf(it.group).appendChild(b);
    buttons.set(it.label, b);
  }

  const toolGroup = groupOf("工具");
  const row = document.createElement("div");
  row.className = "menu-row";
  for (const t of tools) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-item small";
    b.textContent = t.label;
    b.addEventListener("click", () => {
      t.onClick();
      b.blur();
    });
    row.appendChild(b);
  }
  toolGroup.appendChild(row);

  const apply = () => {
    root.classList.toggle("collapsed", collapsed);
    head.setAttribute("aria-expanded", String(!collapsed));
  };
  head.addEventListener("click", () => {
    collapsed = !collapsed;
    apply();
    head.blur();
    try {
      localStorage.setItem("menu-collapsed", collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  });
  apply();

  // 鼠标在菜单上时不要触发场景拖拽视角
  root.addEventListener("pointerdown", (e) => e.stopPropagation());

  return {
    setActive(label) {
      for (const [k, b] of buttons) b.classList.toggle("active", k === label);
    },
  };
}
