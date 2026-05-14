import { useState, useEffect } from "react";

// ─── 기본 카테고리 ───────────────────────────────────────────
const DEFAULT_INGREDIENT_TAGS = ["소고기","돼지고기","닭고기","해산물","두부/달걀","채소","기타재료"];
const DEFAULT_COOKING_TAGS = ["구이","볶음","튀김","찜/조림","국/찌개","면류","밥/덮밥","카레","날것/샐러드","빵/기타"];
const MEAL_TYPES = ["아침","점심","저녁"];
const DAYS = ["월","화","수","목","금","토","일"];

function getWeekDates(weekOffset = 0) {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1) + weekOffset * 7;
  const monday = new Date(now.setDate(diff));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function formatDate(d) {
  return `${d.getMonth()+1}/${d.getDate()}`;
}

// ─── AI API 호출 ─────────────────────────────────────────────
async function callClaude(prompt, systemPrompt = "") {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt || "You are a helpful Korean meal planning assistant. Always respond in Korean. Return only valid JSON when asked.",
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await response.json();
  return data.content?.[0]?.text || "";
}

// ─── 메인 앱 ─────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("planner");
  const [recipes, setRecipes] = useState([]);
  const [fridge, setFridge] = useState([]);
  const [mealPlan, setMealPlan] = useState({});
  const [ingredientTags, setIngredientTags] = useState(DEFAULT_INGREDIENT_TAGS);
  const [cookingTags, setCookingTags] = useState(DEFAULT_COOKING_TAGS);
  const [weekOffset, setWeekOffset] = useState(0);
  const [notification, setNotification] = useState(null);

  // persist
  useEffect(() => {
    try {
      const r = localStorage.getItem("recipes"); if (r) setRecipes(JSON.parse(r));
      const f = localStorage.getItem("fridge"); if (f) setFridge(JSON.parse(f));
      const m = localStorage.getItem("mealPlan"); if (m) setMealPlan(JSON.parse(m));
      const it = localStorage.getItem("ingredientTags"); if (it) setIngredientTags(JSON.parse(it));
      const ct = localStorage.getItem("cookingTags"); if (ct) setCookingTags(JSON.parse(ct));
    } catch {}
  }, []);

  useEffect(() => { localStorage.setItem("recipes", JSON.stringify(recipes)); }, [recipes]);
  useEffect(() => { localStorage.setItem("fridge", JSON.stringify(fridge)); }, [fridge]);
  useEffect(() => { localStorage.setItem("mealPlan", JSON.stringify(mealPlan)); }, [mealPlan]);
  useEffect(() => { localStorage.setItem("ingredientTags", JSON.stringify(ingredientTags)); }, [ingredientTags]);
  useEffect(() => { localStorage.setItem("cookingTags", JSON.stringify(cookingTags)); }, [cookingTags]);

  const notify = (msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 2500);
  };

  const weeks = [0, 1].map(o => getWeekDates(weekOffset + o));
  const allWeekDates = [...weeks[0], ...weeks[1]];

  return (
    <div style={s.app}>
      <style>{css}</style>
      {notification && (
        <div style={{ ...s.toast, background: notification.type === "error" ? "#ef4444" : "#22c55e" }}>
          {notification.msg}
        </div>
      )}

      {/* 헤더 */}
      <header style={s.header}>
        <div style={s.logo}>🍳 <span style={s.logoText}>나의 식단</span></div>
        <nav style={s.nav}>
          {[["planner","📅 식단표"],["recipes","📖 레시피"],["fridge","🧊 냉장고"]].map(([key,label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ ...s.navBtn, ...(tab === key ? s.navActive : {}) }}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main style={s.main}>
        {tab === "planner" && (
          <PlannerTab
            recipes={recipes} mealPlan={mealPlan} setMealPlan={setMealPlan}
            allWeekDates={allWeekDates} weekOffset={weekOffset} setWeekOffset={setWeekOffset}
            fridge={fridge} notify={notify}
          />
        )}
        {tab === "recipes" && (
          <RecipesTab
            recipes={recipes} setRecipes={setRecipes}
            ingredientTags={ingredientTags} setIngredientTags={setIngredientTags}
            cookingTags={cookingTags} setCookingTags={setCookingTags}
            notify={notify}
          />
        )}
        {tab === "fridge" && (
          <FridgeTab fridge={fridge} setFridge={setFridge} notify={notify} />
        )}
      </main>
    </div>
  );
}

// ─── 식단표 탭 ────────────────────────────────────────────────
function PlannerTab({ recipes, mealPlan, setMealPlan, allWeekDates, weekOffset, setWeekOffset, fridge, notify }) {
  const [aiLoading, setAiLoading] = useState(false);
  const [editCell, setEditCell] = useState(null); // {dateKey, meal}
  const [suggestions, setSuggestions] = useState(null); // AI 추천 결과
  const [suggestTarget, setSuggestTarget] = useState(null);

  const dateKey = (d) => d.toISOString().split("T")[0];

  const getMeal = (d, meal) => mealPlan[dateKey(d)]?.[meal] || "";
  const setMeal = (d, meal, value) => {
    const k = dateKey(d);
    setMealPlan(prev => ({ ...prev, [k]: { ...(prev[k] || {}), [meal]: value } }));
  };

  // AI 추천
  const suggestMeals = async (d, meal) => {
    setAiLoading(true);
    setSuggestTarget({ d, meal });
    const k = dateKey(d);
    const dayMeals = mealPlan[k] || {};
    const pastMeals = Object.entries(mealPlan).map(([date, meals]) =>
      `${date}: ${Object.entries(meals).map(([m,v])=>`${m}-${v}`).join(", ")}`
    ).slice(-14).join("\n");

    const prompt = `
레시피 목록: ${JSON.stringify(recipes.map(r => ({ name: r.name, ingredientTag: r.ingredientTag, cookingTag: r.cookingTag })))}
냉장고 재료: ${fridge.join(", ")}
오늘(${k}) 이미 정해진 식사: ${JSON.stringify(dayMeals)}
최근 2주 식단:
${pastMeals}

규칙:
- 같은 날 같은 재료 태그 겹치지 않게
- 같은 날 같은 조리법 태그 겹치지 않게
- 이번 주에 이미 나온 메뉴 제외
- 냉장고 재료 활용 우선
- 최근에 자주 먹은 메뉴는 피하기

${k} ${meal}에 어울리는 레시피 3개를 추천해줘.
반드시 아래 JSON 형식으로만 응답:
{"suggestions": ["레시피명1", "레시피명2", "레시피명3"], "reason": "추천 이유 한줄"}
레시피 목록에 없는 메뉴는 추천하지 마.
`;
    try {
      const text = await callClaude(prompt);
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setSuggestions(parsed);
    } catch {
      notify("AI 추천을 불러오지 못했어요", "error");
    }
    setAiLoading(false);
  };

  const applySuggestion = (name) => {
    if (suggestTarget) {
      setMeal(suggestTarget.d, suggestTarget.meal, name);
      setSuggestions(null);
      setSuggestTarget(null);
      notify(`${name} 추가됐어요!`);
    }
  };

  // 2주치 렌더
  const weeks = [allWeekDates.slice(0,7), allWeekDates.slice(7,14)];

  return (
    <div>
      <div style={s.plannerHeader}>
        <button style={s.weekBtn} onClick={() => setWeekOffset(w => w - 2)}>← 이전</button>
        <span style={s.weekLabel}>
          {formatDate(allWeekDates[0])} – {formatDate(allWeekDates[13])}
        </span>
        <button style={s.weekBtn} onClick={() => setWeekOffset(w => w + 2)}>다음 →</button>
      </div>

      {weeks.map((week, wi) => (
        <div key={wi} style={s.weekBlock}>
          <div style={s.weekTitle}>{wi === 0 ? "이번주" : "다음주"} ({formatDate(week[0])} ~ {formatDate(week[6])})</div>
          <div style={s.plannerGrid}>
            {/* 헤더 */}
            <div style={s.plannerCorner}></div>
            {week.map((d, i) => (
              <div key={i} style={s.plannerDayHeader}>
                <span style={s.dayName}>{DAYS[i]}</span>
                <span style={s.dayDate}>{formatDate(d)}</span>
              </div>
            ))}
            {/* 행 */}
            {MEAL_TYPES.map(meal => (
              <>
                <div key={meal} style={s.mealLabel}>{meal}</div>
                {week.map((d, i) => {
                  const val = getMeal(d, meal);
                  const isEditing = editCell?.dateKey === dateKey(d) && editCell?.meal === meal;
                  return (
                    <div key={i} style={s.mealCell}>
                      {isEditing ? (
                        <input
                          autoFocus
                          style={s.cellInput}
                          defaultValue={val}
                          onBlur={e => { setMeal(d, meal, e.target.value); setEditCell(null); }}
                          onKeyDown={e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setEditCell(null); }}
                        />
                      ) : (
                        <div style={s.cellContent} onClick={() => setEditCell({ dateKey: dateKey(d), meal })}>
                          {val ? (
                            <span style={s.cellMealName}>{val}</span>
                          ) : (
                            <span style={s.cellEmpty}>+</span>
                          )}
                        </div>
                      )}
                      <button
                        style={s.aiBtn}
                        onClick={() => suggestMeals(d, meal)}
                        title="AI 추천"
                      >✨</button>
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </div>
      ))}

      {/* AI 추천 모달 */}
      {(aiLoading || suggestions) && (
        <div style={s.modalOverlay} onClick={() => { setSuggestions(null); setSuggestTarget(null); }}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>✨ AI 추천</div>
            {aiLoading ? (
              <div style={s.loading}>
                <div className="spinner" />
                <p>추천 메뉴 고르는 중...</p>
              </div>
            ) : suggestions ? (
              <>
                <p style={s.suggestReason}>{suggestions.reason}</p>
                <div style={s.suggestList}>
                  {suggestions.suggestions.map(name => (
                    <button key={name} style={s.suggestItem} onClick={() => applySuggestion(name)}>
                      🍽 {name}
                    </button>
                  ))}
                </div>
                <button style={s.modalClose} onClick={() => { setSuggestions(null); setSuggestTarget(null); }}>닫기</button>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 레시피 탭 ────────────────────────────────────────────────
function RecipesTab({ recipes, setRecipes, ingredientTags, setIngredientTags, cookingTags, setCookingTags, notify }) {
  const [view, setView] = useState("list"); // list | add | detail
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ name: "", ingredients: "", steps: "", ingredientTag: "", cookingTag: "", memo: "" });
  const [aiTagging, setAiTagging] = useState(false);
  const [newIngTag, setNewIngTag] = useState("");
  const [newCookTag, setNewCookTag] = useState("");
  const [search, setSearch] = useState("");

  const resetForm = () => setForm({ name: "", ingredients: "", steps: "", ingredientTag: "", cookingTag: "", memo: "" });

  const autoTag = async () => {
    if (!form.name && !form.ingredients) return notify("이름이나 재료를 먼저 입력해주세요", "error");
    setAiTagging(true);
    const prompt = `
레시피 이름: ${form.name}
재료: ${form.ingredients}

재료 태그 목록: ${ingredientTags.join(", ")}
조리법 태그 목록: ${cookingTags.join(", ")}

이 레시피에 가장 어울리는 재료 태그 1개와 조리법 태그 1개를 골라줘.
반드시 아래 JSON 형식으로만 응답:
{"ingredientTag": "태그명", "cookingTag": "태그명"}
`;
    try {
      const text = await callClaude(prompt);
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setForm(f => ({ ...f, ...parsed }));
      notify("태그 자동 설정됐어요!");
    } catch {
      notify("자동 태그 실패", "error");
    }
    setAiTagging(false);
  };

  const saveRecipe = () => {
    if (!form.name.trim()) return notify("레시피 이름을 입력해주세요", "error");
    if (selected !== null) {
      setRecipes(prev => prev.map((r, i) => i === selected ? { ...form } : r));
      notify("수정됐어요!");
    } else {
      setRecipes(prev => [...prev, { ...form, id: Date.now() }]);
      notify("레시피 저장됐어요!");
    }
    resetForm();
    setSelected(null);
    setView("list");
  };

  const deleteRecipe = (i) => {
    setRecipes(prev => prev.filter((_, idx) => idx !== i));
    notify("삭제됐어요");
    setView("list");
  };

  const filtered = recipes.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.ingredientTag?.includes(search) ||
    r.cookingTag?.includes(search)
  );

  if (view === "add" || view === "edit") return (
    <div style={s.formWrap}>
      <div style={s.formHeader}>
        <button style={s.backBtn} onClick={() => { setView("list"); resetForm(); setSelected(null); }}>← 뒤로</button>
        <h2 style={s.formTitle}>{view === "edit" ? "레시피 수정" : "새 레시피"}</h2>
      </div>
      <div style={s.field}>
        <label style={s.label}>레시피 이름</label>
        <input style={s.input} value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="예: 된장찌개" />
      </div>
      <div style={s.field}>
        <label style={s.label}>재료</label>
        <textarea style={s.textarea} value={form.ingredients} onChange={e => setForm(f => ({...f, ingredients: e.target.value}))} placeholder="두부, 된장, 애호박, 파..." rows={3} />
      </div>
      <div style={s.field}>
        <label style={s.label}>조리법</label>
        <textarea style={s.textarea} value={form.steps} onChange={e => setForm(f => ({...f, steps: e.target.value}))} placeholder="1. 냄비에 물을 끓인다..." rows={4} />
      </div>

      {/* 태그 */}
      <div style={s.tagRow}>
        <button style={s.autoTagBtn} onClick={autoTag} disabled={aiTagging}>
          {aiTagging ? "분석 중..." : "✨ AI 자동 태그"}
        </button>
      </div>

      <div style={s.field}>
        <label style={s.label}>재료 태그</label>
        <div style={s.tagGrid}>
          {ingredientTags.map(t => (
            <button key={t} style={{ ...s.tagChip, ...(form.ingredientTag === t ? s.tagChipActive : {}) }}
              onClick={() => setForm(f => ({...f, ingredientTag: t}))}>
              {t}
            </button>
          ))}
        </div>
        <div style={s.addTagRow}>
          <input style={s.tagInput} value={newIngTag} onChange={e => setNewIngTag(e.target.value)} placeholder="새 재료 태그" />
          <button style={s.addTagBtn} onClick={() => {
            if (newIngTag.trim()) { setIngredientTags(p => [...p, newIngTag.trim()]); setNewIngTag(""); }
          }}>추가</button>
        </div>
      </div>

      <div style={s.field}>
        <label style={s.label}>조리법 태그</label>
        <div style={s.tagGrid}>
          {cookingTags.map(t => (
            <button key={t} style={{ ...s.tagChip, ...(form.cookingTag === t ? s.tagChipActive : {}) }}
              onClick={() => setForm(f => ({...f, cookingTag: t}))}>
              {t}
            </button>
          ))}
        </div>
        <div style={s.addTagRow}>
          <input style={s.tagInput} value={newCookTag} onChange={e => setNewCookTag(e.target.value)} placeholder="새 조리법 태그" />
          <button style={s.addTagBtn} onClick={() => {
            if (newCookTag.trim()) { setCookingTags(p => [...p, newCookTag.trim()]); setNewCookTag(""); }
          }}>추가</button>
        </div>
      </div>

      <div style={s.field}>
        <label style={s.label}>메모</label>
        <input style={s.input} value={form.memo} onChange={e => setForm(f => ({...f, memo: e.target.value}))} placeholder="팁이나 변형 아이디어..." />
      </div>

      <button style={s.saveBtn} onClick={saveRecipe}>💾 저장</button>
    </div>
  );

  if (view === "detail" && selected !== null) {
    const r = recipes[selected];
    return (
      <div style={s.formWrap}>
        <div style={s.formHeader}>
          <button style={s.backBtn} onClick={() => setView("list")}>← 뒤로</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={s.editBtn} onClick={() => { setForm(r); setView("edit"); }}>✏️ 수정</button>
            <button style={s.deleteBtn} onClick={() => deleteRecipe(selected)}>🗑 삭제</button>
          </div>
        </div>
        <h2 style={s.detailTitle}>{r.name}</h2>
        <div style={s.detailTags}>
          {r.ingredientTag && <span style={s.tag}>{r.ingredientTag}</span>}
          {r.cookingTag && <span style={{...s.tag, background:"#dbeafe", color:"#1d4ed8"}}>{r.cookingTag}</span>}
        </div>
        {r.ingredients && <>
          <h3 style={s.sectionHead}>🥕 재료</h3>
          <p style={s.detailText}>{r.ingredients}</p>
        </>}
        {r.steps && <>
          <h3 style={s.sectionHead}>📝 조리법</h3>
          <p style={s.detailText}>{r.steps}</p>
        </>}
        {r.memo && <>
          <h3 style={s.sectionHead}>💡 메모</h3>
          <p style={s.detailText}>{r.memo}</p>
        </>}
      </div>
    );
  }

  return (
    <div>
      <div style={s.listHeader}>
        <input style={s.searchInput} value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 레시피 검색..." />
        <button style={s.addBtn} onClick={() => { resetForm(); setView("add"); }}>+ 새 레시피</button>
      </div>
      {filtered.length === 0 ? (
        <div style={s.empty}>
          <div style={s.emptyIcon}>📖</div>
          <p>레시피가 없어요.<br/>첫 레시피를 추가해보세요!</p>
        </div>
      ) : (
        <div style={s.recipeGrid}>
          {filtered.map((r, i) => (
            <div key={i} style={s.recipeCard} onClick={() => { setSelected(i); setView("detail"); }}>
              <div style={s.cardName}>{r.name}</div>
              <div style={s.cardTags}>
                {r.ingredientTag && <span style={s.tag}>{r.ingredientTag}</span>}
                {r.cookingTag && <span style={{...s.tag, background:"#dbeafe", color:"#1d4ed8"}}>{r.cookingTag}</span>}
              </div>
              {r.memo && <div style={s.cardMemo}>{r.memo}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 냉장고 탭 ────────────────────────────────────────────────
function FridgeTab({ fridge, setFridge, notify }) {
  const [input, setInput] = useState("");

  const add = () => {
    const items = input.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
    if (!items.length) return;
    setFridge(prev => [...new Set([...prev, ...items])]);
    setInput("");
    notify(`${items.join(", ")} 추가됐어요!`);
  };

  const remove = (item) => {
    setFridge(prev => prev.filter(i => i !== item));
  };

  return (
    <div>
      <h2 style={s.sectionTitle}>🧊 냉장고 재료</h2>
      <div style={s.fridgeInputRow}>
        <input
          style={s.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && add()}
          placeholder="재료 입력 (쉼표나 띄어쓰기로 여러 개)"
        />
        <button style={s.addBtn} onClick={add}>추가</button>
      </div>
      {fridge.length === 0 ? (
        <div style={s.empty}>
          <div style={s.emptyIcon}>🧊</div>
          <p>냉장고가 비어있어요!</p>
        </div>
      ) : (
        <div style={s.fridgeGrid}>
          {fridge.map(item => (
            <div key={item} style={s.fridgeItem}>
              <span>{item}</span>
              <button style={s.removeBtn} onClick={() => remove(item)}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────
const s = {
  app: { minHeight: "100vh", background: "#f8f7f4", fontFamily: "'Noto Sans KR', sans-serif", color: "#1a1a1a" },
  toast: { position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", color: "#fff", padding: "10px 24px", borderRadius: 24, zIndex: 9999, fontSize: 14, fontWeight: 600, boxShadow: "0 4px 20px rgba(0,0,0,0.15)" },
  header: { background: "#fff", borderBottom: "1px solid #e5e5e5", padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, position: "sticky", top: 0, zIndex: 100 },
  logo: { display: "flex", alignItems: "center", gap: 6, fontSize: 20 },
  logoText: { fontWeight: 800, fontSize: 16, letterSpacing: -0.5 },
  nav: { display: "flex", gap: 4 },
  navBtn: { padding: "6px 12px", borderRadius: 20, border: "none", background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#666" },
  navActive: { background: "#1a1a1a", color: "#fff" },
  main: { maxWidth: 900, margin: "0 auto", padding: "20px 16px" },

  // Planner
  plannerHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  weekBtn: { padding: "6px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 13 },
  weekLabel: { fontWeight: 700, fontSize: 14 },
  weekBlock: { marginBottom: 28 },
  weekTitle: { fontSize: 13, fontWeight: 700, color: "#888", marginBottom: 8, letterSpacing: 0.5 },
  plannerGrid: { display: "grid", gridTemplateColumns: "52px repeat(7, 1fr)", gap: 2, background: "#e5e5e5", borderRadius: 12, overflow: "hidden", border: "1px solid #e5e5e5" },
  plannerCorner: { background: "#f0eeeb", padding: 8 },
  plannerDayHeader: { background: "#f0eeeb", padding: "8px 4px", textAlign: "center", display: "flex", flexDirection: "column", gap: 2 },
  dayName: { fontSize: 13, fontWeight: 700 },
  dayDate: { fontSize: 11, color: "#888" },
  mealLabel: { background: "#f0eeeb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: "#555" },
  mealCell: { background: "#fff", padding: 4, minHeight: 52, display: "flex", flexDirection: "column", gap: 2 },
  cellContent: { flex: 1, cursor: "pointer", borderRadius: 6, padding: "4px 6px", display: "flex", alignItems: "center", "&:hover": { background: "#f5f5f5" } },
  cellMealName: { fontSize: 11, lineHeight: 1.3, color: "#1a1a1a", wordBreak: "keep-all" },
  cellEmpty: { fontSize: 18, color: "#ddd", margin: "auto" },
  cellInput: { fontSize: 11, border: "1px solid #6366f1", borderRadius: 4, padding: "2px 4px", width: "100%", outline: "none" },
  aiBtn: { fontSize: 12, border: "none", background: "transparent", cursor: "pointer", padding: "0 2px", opacity: 0.5, alignSelf: "flex-end" },

  // Modal
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modal: { background: "#fff", borderRadius: 16, padding: 24, width: 320, maxWidth: "90vw" },
  modalTitle: { fontSize: 18, fontWeight: 800, marginBottom: 12 },
  modalClose: { marginTop: 16, width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: 8, cursor: "pointer", background: "#fff", fontSize: 14 },
  loading: { textAlign: "center", padding: "20px 0", color: "#666" },
  suggestReason: { fontSize: 12, color: "#888", marginBottom: 12, lineHeight: 1.5 },
  suggestList: { display: "flex", flexDirection: "column", gap: 8 },
  suggestItem: { padding: "12px 16px", background: "#f8f7f4", border: "1px solid #e5e5e5", borderRadius: 10, cursor: "pointer", textAlign: "left", fontSize: 14, fontWeight: 600 },

  // Recipes
  listHeader: { display: "flex", gap: 10, marginBottom: 16 },
  searchInput: { flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", fontSize: 14, outline: "none" },
  addBtn: { padding: "10px 16px", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" },
  recipeGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 },
  recipeCard: { background: "#fff", borderRadius: 12, padding: 16, cursor: "pointer", border: "1px solid #eee", transition: "box-shadow 0.2s" },
  cardName: { fontWeight: 700, fontSize: 15, marginBottom: 8 },
  cardTags: { display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 },
  cardMemo: { fontSize: 12, color: "#888", marginTop: 4 },
  tag: { fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "#f0fdf4", color: "#16a34a", fontWeight: 600 },

  // Form
  formWrap: { maxWidth: 560, margin: "0 auto" },
  formHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  formTitle: { fontSize: 20, fontWeight: 800, margin: 0 },
  backBtn: { border: "none", background: "transparent", cursor: "pointer", fontSize: 14, color: "#666", padding: "4px 0" },
  editBtn: { padding: "6px 12px", border: "1px solid #ddd", borderRadius: 8, cursor: "pointer", background: "#fff", fontSize: 13 },
  deleteBtn: { padding: "6px 12px", border: "1px solid #fca5a5", borderRadius: 8, cursor: "pointer", background: "#fff", fontSize: 13, color: "#ef4444" },
  field: { marginBottom: 16 },
  label: { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#555" },
  input: { width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 10, fontSize: 14, outline: "none", boxSizing: "border-box" },
  textarea: { width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 10, fontSize: 14, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" },
  tagRow: { display: "flex", justifyContent: "flex-end", marginBottom: 12 },
  autoTagBtn: { padding: "8px 16px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 20, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  tagGrid: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  tagChip: { padding: "5px 12px", border: "1px solid #ddd", borderRadius: 20, cursor: "pointer", fontSize: 12, background: "#fff" },
  tagChipActive: { background: "#1a1a1a", color: "#fff", border: "1px solid #1a1a1a" },
  addTagRow: { display: "flex", gap: 6 },
  tagInput: { flex: 1, padding: "6px 10px", border: "1px solid #ddd", borderRadius: 8, fontSize: 13, outline: "none" },
  addTagBtn: { padding: "6px 12px", background: "#f0f0f0", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 },
  saveBtn: { width: "100%", padding: "14px", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 12, cursor: "pointer", fontSize: 16, fontWeight: 700, marginTop: 8 },

  // Detail
  detailTitle: { fontSize: 24, fontWeight: 800, marginBottom: 10 },
  detailTags: { display: "flex", gap: 6, marginBottom: 20 },
  sectionHead: { fontSize: 14, fontWeight: 700, color: "#888", marginBottom: 6, marginTop: 16 },
  detailText: { fontSize: 15, lineHeight: 1.7, color: "#333", whiteSpace: "pre-wrap" },
  sectionTitle: { fontSize: 20, fontWeight: 800, marginBottom: 16 },

  // Fridge
  fridgeInputRow: { display: "flex", gap: 10, marginBottom: 20 },
  fridgeGrid: { display: "flex", flexWrap: "wrap", gap: 8 },
  fridgeItem: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#fff", border: "1px solid #e5e5e5", borderRadius: 20, fontSize: 14 },
  removeBtn: { border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: "#aaa", lineHeight: 1, padding: 0 },

  // Empty
  empty: { textAlign: "center", padding: "60px 20px", color: "#aaa" },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
};

const css = `
  * { box-sizing: border-box; }
  body { margin: 0; }
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap');
  .spinner {
    width: 32px; height: 32px;
    border: 3px solid #eee;
    border-top-color: #6366f1;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin: 0 auto 12px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  button:hover { opacity: 0.85; }
`;
