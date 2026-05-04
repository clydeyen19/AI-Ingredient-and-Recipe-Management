import {
  Apple,
  Beef,
  CalendarDays,
  Camera,
  Carrot,
  Check,
  ChefHat,
  ClipboardList,
  Fish,
  LayoutDashboard,
  Milk,
  Package,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Utensils,
  Wheat
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const API = "";
function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const today = localDateString();
const categories = ["蔬菜", "水果", "肉類", "海鮮", "蛋奶", "主食/澱粉", "調味", "飲品", "其他"];
const units = ["份", "盒", "顆", "包", "瓶", "塊", "罐", "袋", "g", "kg", "ml", "L"];
const categoryIcons = {
  全部: Package,
  蔬菜: Carrot,
  水果: Apple,
  肉類: Beef,
  海鮮: Fish,
  蛋奶: Milk,
  "主食/澱粉": Wheat,
  調味: Package,
  飲品: Package,
  其他: Package
};

function addDays(baseDate, days) {
  const date = new Date(`${baseDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function estimateShelfLife({ name = "", category = "其他", location = "冷藏" }) {
  const lower = name.toLowerCase();
  const text = `${name} ${lower}`;
  const frozen = location === "冷凍";
  if (/米|白飯|飯|糙米|麵|麵條|pasta|noodle|乾麵|義大利麵/.test(text)) return frozen ? 90 : 45;
  if (/牛奶|鮮奶|milk/.test(text)) return frozen ? 30 : 7;
  if (/干貝|蝦|蝦子|貝|scallop|shrimp/.test(text)) return frozen ? 120 : 2;
  if (category === "肉類") return frozen ? 90 : 3;
  if (category === "海鮮") return frozen ? 90 : 2;
  if (category === "蛋奶") return frozen ? 30 : 10;
  if (category === "蔬菜") return frozen ? 30 : 5;
  if (category === "水果") return frozen ? 60 : 7;
  if (category === "主食/澱粉") return frozen ? 90 : 30;
  if (category === "調味") return 180;
  if (category === "飲品") return 14;
  return frozen ? 60 : 7;
}

function estimateExpiration(form) {
  return addDays(form.purchase_date || today, estimateShelfLife(form));
}

const emptyIngredient = {
  name: "",
  category: "蔬菜",
  unit: "份",
  total_quantity: 0,
  remaining_quantity: 0,
  purchase_date: today,
  expiration_date: estimateExpiration({ category: "蔬菜", purchase_date: today, location: "冷藏" }),
  is_opened: false,
  opened_date: "",
  location: "冷藏",
  notes: "",
  image_path: null
};

function App() {
  const [active, setActive] = useState(() => decodeURIComponent(window.location.hash.replace("#", "")) || "Overview");
  const [summary, setSummary] = useState(null);
  const [ingredients, setIngredients] = useState([]);
  const [meals, setMeals] = useState([]);
  const [weeklyUsage, setWeeklyUsage] = useState(null);
  const [weeklyPlan, setWeeklyPlan] = useState(null);
  const [ingredientForm, setIngredientForm] = useState(emptyIngredient);
  const [mealForm, setMealForm] = useState({ meal_date: today, meal_type: "breakfast", description: "", image: null });
  const [mealDate, setMealDate] = useState(today);
  const [categoryFilter, setCategoryFilter] = useState("全部");
  const [aiText, setAiText] = useState("");
  const [aiImage, setAiImage] = useState(null);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [summaryRes, ingredientsRes, mealsRes, planRes, usageRes] = await Promise.all([
      fetch(`${API}/api/summary`),
      fetch(`${API}/api/ingredients`),
      fetch(`${API}/api/meals`),
      fetch(`${API}/api/weekly-plan/latest`),
      fetch(`${API}/api/usage/weekly`)
    ]);
    setSummary(await summaryRes.json());
    setIngredients(await ingredientsRes.json());
    setMeals(await mealsRes.json());
    setWeeklyPlan(await planRes.json());
    setWeeklyUsage(await usageRes.json());
  }

  useEffect(() => {
    refresh().catch((error) => setStatus(error.message));
  }, []);

  function selectSection(section) {
    setActive(section);
    window.location.hash = encodeURIComponent(section);
  }

  const expiring = useMemo(
    () => ingredients.filter((item) => item.is_expiring_soon || item.days_until_expiry < 0).slice(0, 6),
    [ingredients]
  );
  const urgentInventory = useMemo(
    () => ingredients.filter((item) => item.is_expiring_soon || item.is_low_stock || item.days_until_expiry < 0).slice(0, 6),
    [ingredients]
  );
  const filteredIngredients = useMemo(
    () => categoryFilter === "全部" ? ingredients : ingredients.filter((item) => item.category === categoryFilter),
    [ingredients, categoryFilter]
  );
  const dayMeals = useMemo(
    () => meals.filter((meal) => meal.meal_date === mealDate),
    [meals, mealDate]
  );

  async function saveIngredient(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    const payload = {
      ...ingredientForm,
      total_quantity: Number(ingredientForm.total_quantity || 0),
      remaining_quantity: Number(ingredientForm.remaining_quantity || 0),
      purchase_date: ingredientForm.purchase_date || today,
      expiration_date: ingredientForm.expiration_date || null,
      opened_date: ingredientForm.opened_date || null
    };
    await fetch(`${API}/api/ingredients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setIngredientForm(emptyIngredient);
    await refresh();
    setStatus("食材已新增");
    setBusy(false);
  }

  async function deleteIngredient(id) {
    await fetch(`${API}/api/ingredients/${id}`, { method: "DELETE" });
    await refresh();
  }

  async function updateQuantity(id, remainingQuantity) {
    await fetch(`${API}/api/ingredients/${id}/quantity`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remaining_quantity: Number(remainingQuantity || 0) })
    });
    await refresh();
  }

  async function updateIngredient(id, payload) {
    await fetch(`${API}/api/ingredients/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    await refresh();
  }

  async function createMeal(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    const form = new FormData();
    form.append("meal_date", mealForm.meal_date);
    form.append("meal_type", mealForm.meal_type);
    form.append("description", mealForm.description);
    if (mealForm.image) form.append("image", mealForm.image);
    const res = await fetch(`${API}/api/meals`, { method: "POST", body: form });
    const meal = await res.json();
    await refresh();
    setMealForm({ meal_date: today, meal_type: "breakfast", description: "", image: null });
    setMealDate(mealForm.meal_date);
    setStatus(`已新增餐點 #${meal.id}`);
    setBusy(false);
  }

  async function analyzeMeal(mealId) {
    setBusy(true);
    setStatus("AI 正在分析餐點...");
    const res = await fetch(`${API}/api/meals/${mealId}/analyze`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) setStatus(data.detail || "AI 分析失敗");
    else setStatus(`AI 建議：${data.dish_name}`);
    await refresh();
    setBusy(false);
  }

  async function analyzeDayMeals() {
    const targets = dayMeals.length ? dayMeals : meals.filter((meal) => meal.meal_date === today);
    if (!targets.length) {
      setStatus("當天尚無三餐紀錄可分析");
      return;
    }
    setBusy(true);
    setStatus("AI 正在分析當天三餐用量...");
    for (const meal of targets) {
      const res = await fetch(`${API}/api/meals/${meal.id}/analyze`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setStatus(data.detail || "AI 分析失敗");
        setBusy(false);
        return;
      }
    }
    await refresh();
    setStatus("當天三餐已分析，請確認後更新庫存");
    setBusy(false);
  }

  async function confirmUsages(meal) {
    const source = meal.usages?.length ? meal.usages : meal.ai_result?.ingredient_usages || [];
    const usages = source.map((usage) => ({
      ingredient_id: usage.ingredient_id,
      ingredient_name: usage.ingredient_name,
      quantity: Number(usage.quantity || 0),
      unit: usage.unit || "g",
      confidence: usage.confidence || 0
    }));
    await fetch(`${API}/api/meals/${meal.id}/confirm-usages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usages })
    });
    await refresh();
    setStatus("已確認用量並更新庫存");
  }

  async function confirmDayUsages(draftsByMeal = null) {
    const targets = dayMeals.filter((meal) => meal.ai_result?.ingredient_usages?.length || meal.usages?.length);
    if (!targets.length) {
      setStatus("當天尚無已分析的用量可確認");
      return;
    }
    setBusy(true);
    for (const meal of targets) {
      const draftUsages = draftsByMeal?.[meal.id];
      if (draftUsages) {
        await fetch(`${API}/api/meals/${meal.id}/confirm-usages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usages: draftUsages })
        });
      } else {
        await confirmUsages(meal);
      }
    }
    await refresh();
    setStatus("當天用量已確認並更新庫存");
    setBusy(false);
  }

  async function updateMeal(meal, patch) {
    await fetch(`${API}/api/meals/${meal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meal_date: patch.meal_date ?? meal.meal_date,
        meal_type: patch.meal_type ?? meal.meal_type,
        description: patch.description ?? meal.description ?? ""
      })
    });
    await refresh();
  }

  async function deleteMeal(id) {
    await fetch(`${API}/api/meals/${id}`, { method: "DELETE" });
    await refresh();
  }

  async function analyzeIngredient(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("AI 正在分析食材...");
    const form = new FormData();
    form.append("text", aiText);
    if (aiImage) form.append("image", aiImage);
    const res = await fetch(`${API}/api/ai/analyze-ingredient`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.detail || "AI 分析失敗");
    } else {
      setAiSuggestion(data);
      setIngredientForm({
        ...emptyIngredient,
        name: data.name || "",
        category: data.category || "其他",
        unit: data.unit || "份",
        total_quantity: data.estimated_quantity || 0,
        remaining_quantity: data.estimated_quantity || 0,
        expiration_date: data.suggested_expiration_date || "",
        purchase_date: today,
        is_opened: Boolean(data.is_opened),
        location: data.storage || "冷藏",
        notes: data.notes || "",
        image_path: data.image_path || null
      });
      setStatus("AI 建議已帶入新增食材表單，確認後再儲存");
    }
    setBusy(false);
  }

  async function generatePlan() {
    setBusy(true);
    setStatus("正在產生本週飲食建議...");
    const res = await fetch(`${API}/api/weekly-plan`, { method: "POST" });
    const data = await res.json();
    setWeeklyPlan(data);
    setStatus("週飲食建議已更新");
    setBusy(false);
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <ChefHat size={23} />
          <div>
            <strong>食材飲食管理</strong>
            <span>Local Inventory</span>
          </div>
        </div>
        <nav>
          {[
            ["Overview", LayoutDashboard, "總覽"],
            ["Inventory", Wheat, "庫存"],
            ["Meals", Utensils, "三餐"],
            ["Weekly Plan", CalendarDays, "週菜單"],
            ["AI Assistant", Sparkles, "AI"]
          ].map(([key, Icon, label]) => (
            <button className={active === key ? "active" : ""} key={key} onClick={() => selectSection(key)}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="side-note">AI 建議需人工確認後才會寫入或扣庫存。</div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <h1>{activeLabel(active)}</h1>
            <p>追蹤庫存、有效期限、每日飲食與食材消耗。</p>
          </div>
          <div className="actions">
            <button onClick={() => selectSection("Inventory")}><Plus size={17} />新增食材</button>
            <button onClick={generatePlan} disabled={busy}><Sparkles size={17} />AI 週菜單</button>
          </div>
        </header>

        {status && <div className="status">{status}</div>}

        {active === "Overview" && (
          <section className="grid overview">
            <Metric title="總庫存" value={summary?.total_items ?? 0} tone="green" />
            <Metric title="快過期" value={summary?.expiring_soon ?? 0} tone="red" />
            <Metric title="已開封" value={summary?.opened_items ?? 0} tone="amber" />
            <Metric title="低庫存" value={summary?.low_stock ?? 0} tone="blue" />
            <MealPanel
              meals={dayMeals}
              mealDate={mealDate}
              setMealDate={setMealDate}
              compact
              readOnly
            />
            <PlanPanel plan={weeklyPlan} onGenerate={generatePlan} busy={busy} />
            <WeeklyUsagePanel usage={weeklyUsage} ingredients={ingredients} />
            <InventoryPanel
              ingredients={urgentInventory}
              onDelete={deleteIngredient}
              onQuantityUpdate={updateQuantity}
              onIngredientUpdate={updateIngredient}
              compact
              title="需要注意的庫存"
              hideFilters
            />
          </section>
        )}

        {active === "Inventory" && (
          <section className="two-col">
            <IngredientForm form={ingredientForm} setForm={setIngredientForm} onSubmit={saveIngredient} busy={busy} />
            <InventoryPanel
              ingredients={filteredIngredients}
              allIngredients={ingredients}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              onDelete={deleteIngredient}
              onQuantityUpdate={updateQuantity}
              onIngredientUpdate={updateIngredient}
            />
          </section>
        )}

        {active === "Meals" && (
          <section className="two-col">
            <MealForm form={mealForm} setForm={setMealForm} onSubmit={createMeal} busy={busy} />
            <MealPanel
              meals={dayMeals}
              mealDate={mealDate}
              setMealDate={setMealDate}
              onAnalyzeDay={analyzeDayMeals}
              onConfirmDay={confirmDayUsages}
              onUpdate={updateMeal}
              onDelete={deleteMeal}
            />
          </section>
        )}

        {active === "Weekly Plan" && (
          <section className="two-col plan-page">
            <PlanPanel plan={weeklyPlan} onGenerate={generatePlan} busy={busy} full />
            <ExpiringList items={expiring} />
          </section>
        )}

        {active === "AI Assistant" && (
          <section className="two-col">
            <form className="panel form" onSubmit={analyzeIngredient}>
              <PanelTitle icon={Sparkles} title="食材照片 / 文字分析" />
              <textarea value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder="例如：Costco 雞胸肉一盒、菠菜一包，想估有效期限與數量" />
              <label className="file">
                <Camera size={18} />
                <span>{aiImage ? aiImage.name : "上傳食材照片"}</span>
                <input type="file" accept="image/*" onChange={(e) => setAiImage(e.target.files?.[0] || null)} />
              </label>
              <button disabled={busy}><Sparkles size={17} />產生建議</button>
            </form>
            <div className="panel">
              <PanelTitle icon={ClipboardList} title="AI 建議結果" />
              {aiSuggestion ? <pre>{JSON.stringify(aiSuggestion, null, 2)}</pre> : <p className="muted">分析後會顯示結構化建議，並帶入新增食材表單。</p>}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function activeLabel(active) {
  return {
    Overview: "總覽",
    Inventory: "庫存管理",
    Meals: "三餐紀錄",
    "Weekly Plan": "AI 週飲食計畫",
    "AI Assistant": "AI 助理"
  }[active];
}

function Metric({ title, value, tone }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WeeklyUsagePanel({ usage, ingredients }) {
  const usageData = usage?.items || [];
  const fallbackData = ingredients
    .filter((item) => Number(item.remaining_quantity || 0) > 0)
    .slice()
    .sort((a, b) => Number(b.remaining_quantity || 0) - Number(a.remaining_quantity || 0))
    .slice(0, 8)
    .map((item) => ({
      ingredient_name: item.name,
      unit: item.unit,
      quantity: item.remaining_quantity,
      uses: "目前",
    }));
  const data = usageData.length > 0 ? usageData : fallbackData;
  const isFallback = usageData.length === 0;
  const max = Math.max(1, ...data.map((item) => Number(item.quantity || 0)));

  return (
    <div className="panel chart-panel">
      <PanelTitle icon={ClipboardList} title="本週消耗食材追蹤" />
      <p className="chart-subtitle">
        {usage?.week_start} ~ {usage?.week_end}
        {isFallback ? "｜尚未確認用量，先顯示目前庫存量" : "｜已確認用量"}
      </p>
      {data.length > 0 ? (
        <div className="chart-list">
          {data.slice(0, 8).map((item) => (
            <div className="chart-row" key={`${item.ingredient_name}-${item.unit}`}>
              <span>{item.ingredient_name}</span>
              <div className="chart-track">
                <div className="chart-bar" style={{ width: `${Math.max(8, (Number(item.quantity || 0) / max) * 100)}%` }} />
              </div>
              <strong>{Number(item.quantity || 0).toFixed(1)} {item.unit}</strong>
              <em>{isFallback ? "目前量" : `${item.uses} 次`}</em>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">目前還沒有可追蹤的庫存或本週用量。</p>
      )}
    </div>
  );
}

function PanelTitle({ icon: Icon, title }) {
  return (
    <div className="panel-title">
      <Icon size={18} />
      <h2>{title}</h2>
    </div>
  );
}

function IngredientForm({ form, setForm, onSubmit, busy }) {
  function nextForm(patch) {
    const draft = { ...form, ...patch };
    return { ...draft, expiration_date: estimateExpiration(draft) };
  }

  function updateCategory(category) {
    setForm(nextForm({ category }));
  }

  function updatePurchaseDate(purchase_date) {
    setForm(nextForm({ purchase_date }));
  }

  function updateLocation(location) {
    setForm(nextForm({ location }));
  }

  function updateName(name) {
    setForm(nextForm({ name }));
  }

  function updateQuantity(value) {
    setForm({
      ...form,
      total_quantity: value,
      remaining_quantity: value
    });
  }

  return (
    <form className="panel form" onSubmit={onSubmit}>
      <PanelTitle icon={Plus} title="新增食材" />
      <div className="form-grid">
        <input required placeholder="食材名稱" value={form.name} onChange={(e) => updateName(e.target.value)} />
        <select value={form.category} onChange={(e) => updateCategory(e.target.value)}>
          {categories.map((x) => <option key={x}>{x}</option>)}
        </select>
        <input className="span-field" type="number" min="0" step="0.1" placeholder="份量" value={form.total_quantity} onChange={(e) => updateQuantity(e.target.value)} />
        <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
          {units.map((x) => <option key={x}>{x}</option>)}
        </select>
        <label className="field-label">
          <span>購買日期</span>
          <input type="date" value={form.purchase_date || today} onChange={(e) => updatePurchaseDate(e.target.value)} />
        </label>
        <label className="field-label">
          <span>有效期限</span>
          <input type="date" value={form.expiration_date || ""} onChange={(e) => setForm({ ...form, expiration_date: e.target.value })} />
        </label>
        <select value={form.location} onChange={(e) => updateLocation(e.target.value)}>
          {["冷藏", "冷凍", "常溫", "其他"].map((x) => <option key={x}>{x}</option>)}
        </select>
        <label className="checkbox"><input type="checkbox" checked={form.is_opened} onChange={(e) => setForm({ ...form, is_opened: e.target.checked })} />已開封</label>
      </div>
      <textarea placeholder="備註" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      <button disabled={busy}><Check size={17} />儲存食材</button>
    </form>
  );
}

function InventoryPanel({
  ingredients,
  allIngredients = ingredients,
  categoryFilter = "全部",
  setCategoryFilter,
  onDelete,
  onQuantityUpdate,
  onIngredientUpdate,
  compact = false,
  title = "食材庫存",
  hideFilters = false
}) {
  return (
    <div className={`panel inventory-panel ${compact ? "span-2" : ""}`}>
      <PanelTitle icon={Wheat} title={title} />
      {!hideFilters && (
        <div className="category-filter">
          {["全部", ...categories].map((category) => {
            const Icon = categoryIcons[category] || Package;
            const count = category === "全部" ? allIngredients.length : allIngredients.filter((item) => item.category === category).length;
            return (
              <button className={categoryFilter === category ? "active" : ""} key={category} onClick={() => setCategoryFilter?.(category)}>
                <Icon size={16} />
                <span>{category}</span>
                <small>{count}</small>
              </button>
            );
          })}
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>食材</th>
              {!compact && <th>種類</th>}
              <th>剩餘</th>
              <th>期限</th>
              {!compact && <th>存放</th>}
              {!compact && <th>狀態</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong><span>{item.location}</span></td>
                {!compact && <td>
                  <select
                    className="table-control"
                    value={item.category}
                    onChange={(event) => onIngredientUpdate?.(item.id, { ...item, category: event.target.value })}
                  >
                    {categories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </td>}
                <td>
                  <div className="quantity-edit">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      defaultValue={item.remaining_quantity}
                      onBlur={(event) => {
                        const value = Number(event.target.value || 0);
                        if (value !== item.remaining_quantity) onQuantityUpdate?.(item.id, value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                    <span>{item.unit}</span>
                  </div>
                </td>
                <td>
                  <input
                    className="table-control date-control"
                    type="date"
                    defaultValue={item.expiration_date || ""}
                    onBlur={(event) => {
                      const value = event.target.value || null;
                      if (value !== item.expiration_date) onIngredientUpdate?.(item.id, { ...item, expiration_date: value });
                    }}
                  />
                  <ExpiryBadge days={item.days_until_expiry} date={item.expiration_date} />
                </td>
                {!compact && <td>
                  <select
                    className="table-control"
                    value={item.location}
                    onChange={(event) => onIngredientUpdate?.(item.id, { ...item, location: event.target.value })}
                  >
                    {["冷藏", "冷凍", "常溫", "其他"].map((x) => <option key={x}>{x}</option>)}
                  </select>
                </td>}
                {!compact && <td>
                  <select
                    className="table-control"
                    value={item.is_opened ? "open" : "closed"}
                    onChange={(event) => onIngredientUpdate?.(item.id, { ...item, is_opened: event.target.value === "open" })}
                  >
                    <option value="closed">未開封</option>
                    <option value="open">已開封</option>
                  </select>
                </td>}
                <td><button className="icon danger" onClick={() => onDelete(item.id)} aria-label="刪除"><Trash2 size={16} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExpiryBadge({ days, date }) {
  if (days === null || days === undefined) return <span className="muted">無期限</span>;
  const cls = days < 0 ? "tag red" : days <= 3 ? "tag red" : days <= 7 ? "tag amber" : "tag green";
  return <span className={cls}>{days < 0 ? `過期 ${Math.abs(days)} 天` : `${days} 天`}<small>{date}</small></span>;
}

function MealForm({ form, setForm, onSubmit, busy }) {
  return (
    <form className="panel form" onSubmit={onSubmit}>
      <PanelTitle icon={Utensils} title="新增三餐紀錄" />
      <div className="form-grid">
        <input type="date" value={form.meal_date} onChange={(e) => setForm({ ...form, meal_date: e.target.value })} />
        <select value={form.meal_type} onChange={(e) => setForm({ ...form, meal_type: e.target.value })}>
          <option value="breakfast">早餐</option>
          <option value="lunch">午餐</option>
          <option value="dinner">晚餐</option>
        </select>
      </div>
      <textarea placeholder="餐點描述，例如：雞胸肉菠菜便當" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <label className="file">
        <Camera size={18} />
        <span>{form.image ? form.image.name : "上傳餐點照片"}</span>
        <input type="file" accept="image/*" onChange={(e) => setForm({ ...form, image: e.target.files?.[0] || null })} />
      </label>
      <button disabled={busy}><Plus size={17} />儲存餐點</button>
    </form>
  );
}

function MealPanel({ meals, mealDate, setMealDate, onAnalyzeDay, onConfirmDay, onUpdate, onDelete, compact = false, readOnly = false }) {
  const [draftUsages, setDraftUsages] = useState({});
  const [confirmedMeals, setConfirmedMeals] = useState(new Set());

  useEffect(() => {
    const next = {};
    for (const meal of meals) {
      const source = meal.ai_result?.ingredient_usages?.length ? meal.ai_result.ingredient_usages : meal.usages || [];
      if (source.length && !meal.usages?.some((usage) => usage.confirmed)) {
        next[meal.id] = source.map((usage) => ({
          ingredient_id: usage.ingredient_id,
          ingredient_name: usage.ingredient_name,
          quantity: Number(usage.quantity || 0),
          unit: usage.unit || "份",
          confidence: usage.confidence || 0
        }));
      }
    }
    setDraftUsages(next);
  }, [meals]);

  function updateDraft(mealId, index, patch) {
    setDraftUsages((current) => ({
      ...current,
      [mealId]: (current[mealId] || []).map((usage, usageIndex) => usageIndex === index ? { ...usage, ...patch } : usage)
    }));
  }

  return (
    <div className={`panel meal-panel ${compact ? "span-2" : ""}`}>
      <div className="panel-title between">
        <div className="inline-title"><Utensils size={18} /><h2>三餐紀錄與用量</h2></div>
        <div className="meal-toolbar">
          <input type="date" value={mealDate} onChange={(event) => setMealDate(event.target.value)} />
          {!readOnly && <button onClick={onAnalyzeDay}><Sparkles size={15} />分析當天</button>}
          {!readOnly && <button onClick={async () => {
            await onConfirmDay(draftUsages);
            setConfirmedMeals(new Set(meals.map((meal) => meal.id)));
            setDraftUsages({});
          }}><Check size={15} />確認更新庫存</button>}
        </div>
      </div>
      <div className="meal-list">
        {meals.slice(0, compact ? 3 : 12).map((meal) => (
          <article className="meal" key={meal.id}>
            {meal.image_path ? <img src={meal.image_path} alt="" /> : <div className="thumb"><Utensils size={20} /></div>}
            <div>
              {readOnly ? (
                <div className="meal-readonly-head">
                  <strong>{mealType(meal.meal_type)}</strong>
                  <span>{meal.meal_date}</span>
                </div>
              ) : (
                <>
                  <div className="meal-edit-row">
                    <select value={meal.meal_type} onChange={(event) => onUpdate(meal, { meal_type: event.target.value })}>
                      <option value="breakfast">早餐</option>
                      <option value="lunch">午餐</option>
                      <option value="dinner">晚餐</option>
                    </select>
                    <input type="date" value={meal.meal_date} onChange={(event) => onUpdate(meal, { meal_date: event.target.value })} />
                  </div>
                  <input
                    className="meal-description"
                    defaultValue={meal.description || ""}
                    placeholder="餐點描述"
                    onBlur={(event) => {
                      if (event.target.value !== (meal.description || "")) onUpdate(meal, { description: event.target.value });
                    }}
                  />
                </>
              )}
              {readOnly && <p>{meal.description || meal.ai_result?.dish_name || "尚未填寫描述"}</p>}
              {meal.ai_result?.summary && <p>{meal.ai_result.summary}</p>}
              {meal.ai_result?.ingredient_usages?.length > 0 && (
                <div className="usage-row">
                  {meal.ai_result.ingredient_usages.map((usage, index) => (
                    <span className="tag" key={`${usage.ingredient_name}-${index}`}>{usage.ingredient_name} {usage.quantity}{usage.unit}</span>
                  ))}
                </div>
              )}
            </div>
            {!readOnly && <div className="meal-actions">
              <button className="icon danger" onClick={() => onDelete(meal.id)} aria-label="刪除餐點"><Trash2 size={16} /></button>
            </div>}
          </article>
        ))}
        {meals.length === 0 && <p className="muted">這天尚無三餐紀錄。</p>}
      </div>
      {!readOnly && Object.keys(draftUsages).length > 0 && (
        <div className="usage-review">
          <h3>確認或調整食材使用量</h3>
          {meals.filter((meal) => draftUsages[meal.id]?.length).map((meal) => (
            <div className="usage-review-group" key={meal.id}>
              <strong>{mealType(meal.meal_type)} · {meal.description || meal.ai_result?.dish_name || "未命名餐點"}</strong>
              {draftUsages[meal.id].map((usage, index) => (
                <div className="usage-edit" key={`${meal.id}-${usage.ingredient_name}-${index}`}>
                  <span>{usage.ingredient_name}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={usage.quantity}
                    onChange={(event) => updateDraft(meal.id, index, { quantity: Number(event.target.value || 0) })}
                  />
                  <select value={usage.unit} onChange={(event) => updateDraft(meal.id, index, { unit: event.target.value })}>
                    {units.map((unit) => <option key={unit}>{unit}</option>)}
                  </select>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {!readOnly && confirmedMeals.size > 0 && Object.keys(draftUsages).length === 0 && (
        <p className="status inline-status">當天用量已確認，庫存已更新。</p>
      )}
    </div>
  );
}

function PlanPanel({ plan, onGenerate, busy, full = false }) {
  return (
    <div className={`panel plan-panel ${full ? "full" : ""}`}>
      <div className="panel-title between">
        <div className="inline-title"><Sparkles size={18} /><h2>AI 本週飲食建議</h2></div>
        <button onClick={onGenerate} disabled={busy}><RefreshCw size={15} />重新產生</button>
      </div>
      <p className="strategy">{plan?.strategy || "依據快過期與已開封食材產生一週早中晚餐建議。"}</p>
      <div className="priority">
        {(plan?.priority_ingredients || []).map((item) => <span className="tag red" key={item}>{item}</span>)}
      </div>
      <div className="plan-days">
        {(plan?.days || []).slice(0, full ? 7 : 4).map((day, index) => (
          <article key={day.day}>
            <strong>{dateLabel(index)}</strong>
            <MealPlanLine label="早" meal={day.breakfast} />
            <MealPlanLine label="午" meal={day.lunch} />
            <MealPlanLine label="晚" meal={day.dinner} />
            {day.use_first?.length > 0 && <em>優先：{day.use_first.join("、")}</em>}
          </article>
        ))}
      </div>
    </div>
  );
}

function dateLabel(index) {
  const date = new Date(`${today}T00:00:00`);
  date.setDate(date.getDate() + index);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function MealPlanLine({ label, meal }) {
  const title = typeof meal === "string" ? meal : meal?.title;
  const ingredients = typeof meal === "string" ? [] : meal?.ingredients || [];
  return (
    <div className="meal-plan-line">
      <b>{label}</b>
      <span>{title || "待規劃"}</span>
      {ingredients.length > 0 && <small>用：{ingredients.join("、")}</small>}
    </div>
  );
}

function ExpiringList({ items }) {
  return (
    <div className="panel">
      <PanelTitle icon={CalendarDays} title="優先消耗食材" />
      {items.map((item) => (
        <div className="priority-item" key={item.id}>
          <strong>{item.name}</strong>
          <ExpiryBadge days={item.days_until_expiry} date={item.expiration_date} />
        </div>
      ))}
    </div>
  );
}

function mealType(type) {
  return { breakfast: "早餐", lunch: "午餐", dinner: "晚餐" }[type] || type;
}

export default App;
