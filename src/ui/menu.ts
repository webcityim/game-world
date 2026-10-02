// 悬浮菜单:可折叠,点击按钮飞向预设位置。

export interface MenuItem {
  label: string;
  group: string;
  onClick: () => void;
}

export interface MenuHandle {
  setActive(label: string | null): void;
  /** 折叠 / 展开菜单 */
  toggle(): void;
}

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, v: string) {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* ignore */
    }
  },
};

/** 一个可记住状态的开关面板(HUD / 说明):返回 toggle 函数。 */
export function bindPanel(el: HTMLElement, key: string, defaultOn: boolean, onChange?: (on: boolean) => void): () => void {
  const saved = store.get(key);
  let on = saved === null ? defaultOn : saved === "1";
  const apply = () => {
    el.classList.toggle("hidden", !on);
    onChange?.(on);
  };
  apply();
  return () => {
    on = !on;
    store.set(key, on ? "1" : "0");
    apply();
  };
}

const GROUP_ICONS: Record<string, string> = { 轨道: "◎", 城市: "▦", 奇观: "✦", 工具: "⚙" };

/** 创建右上角的悬浮菜单。折叠状态写入 localStorage(不可用时静默忽略)。 */
export function createMenu(items: MenuItem[], tools: { label: string; onClick: () => void }[]): MenuHandle {
  const root = document.getElementById("menu")!;
  // 记住上次的折叠状态;第一次打开时,窄屏默认折叠,不挡画面
  const saved = store.get("menu-collapsed");
  let collapsed = saved === null ? window.innerWidth < 760 : saved === "1";

  root.innerHTML = "";
  const head = document.createElement("button");
  head.className = "menu-head";
  head.type = "button";
  head.innerHTML = `<span class="menu-title">☰ 传送 · Teleport <kbd>M</kbd></span><span class="menu-caret" aria-hidden="true">−</span>`;
  head.title = "折叠 / 展开菜单(M)";
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
    // 按钮上只放中文名(英文放进悬停提示),这样两列也放得下
    b.textContent = it.label.split(" / ")[0];
    b.title = it.label;
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

  const caret = head.querySelector(".menu-caret")!;
  const apply = () => {
    root.classList.toggle("collapsed", collapsed);
    head.setAttribute("aria-expanded", String(!collapsed));
    caret.textContent = collapsed ? "＋" : "−";
  };
  const toggle = () => {
    collapsed = !collapsed;
    apply();
    store.set("menu-collapsed", collapsed ? "1" : "0");
  };
  head.addEventListener("click", () => {
    toggle();
    head.blur();
  });
  apply();

  // 鼠标在菜单上时不要触发场景拖拽视角
  root.addEventListener("pointerdown", (e) => e.stopPropagation());

  return {
    setActive(label) {
      for (const [k, b] of buttons) b.classList.toggle("active", k === label);
    },
    toggle,
  };
}
