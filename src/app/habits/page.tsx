"use client";

import { useState } from "react";
import HabitCard from "@/components/HabitCard";
import { useAppContext } from "@/providers/AppProvider";

export default function HabitsPage() {
  const { habits, addHabit, toggleHabit, deleteHabit, updateHabit } = useAppContext();
  const [name, setName] = useState("");
  const [targetType, setTargetType] = useState<"binary" | "count" | "duration" | "frequency">("binary");
  const [targetAmount, setTargetAmount] = useState(1);
  const [unit, setUnit] = useState("");
  const today = new Date().toISOString().split("T")[0];
  const active = habits.filter((habit) => !habit.paused);
  const completed = active.filter((habit) => habit.lastCompleted === today);

  function createHabit() {
    if (!name.trim()) return;
    addHabit(name, { targetType, targetAmount, unit });
    setName("");
    setTargetType("binary");
    setTargetAmount(1);
    setUnit("");
  }

  return (
    <main className="product-page">
      <header className="product-header">
        <div>
          <p className="ass-kicker">Today · {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1>Habits</h1>
          <p>{completed.length} of {active.length} complete</p>
        </div>
        <div className="habit-progress" aria-label={`${completed.length} of ${active.length} habits complete`}>
          {active.length ? Math.round((completed.length / active.length) * 100) : 0}%
        </div>
      </header>

      <section className="product-section" aria-labelledby="today-heading">
        <div className="section-heading"><h2 id="today-heading">Today</h2><span>{completed.length}/{active.length}</span></div>
        <div className="habit-list">
          {active.map((habit) => <HabitCard key={habit.id} habit={habit} onToggle={toggleHabit} onDelete={deleteHabit} onUpdate={updateHabit} />)}
          {!active.length && <div className="quiet-empty"><strong>Add your first habit</strong><span>Small, repeatable actions belong here.</span></div>}
        </div>
      </section>

      <section className="product-section">
        <div className="section-heading"><h2>Add habit</h2></div>
        <div className="habit-create">
          <label className="sr-only" htmlFor="new-habit">Habit name</label>
          <input id="new-habit" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createHabit(); }} placeholder="What do you want to repeat?" className="ass-input flex-1" />
          <select value={targetType} onChange={(event) => setTargetType(event.target.value as typeof targetType)} className="ass-select" aria-label="Habit type">
            <option value="binary">Daily check</option><option value="count">Count</option><option value="duration">Duration</option><option value="frequency">Weekly frequency</option>
          </select>
          {targetType !== "binary" && <input type="number" min="1" value={targetAmount} onChange={(event) => setTargetAmount(Math.max(1, Number(event.target.value)))} className="ass-input habit-target" aria-label="Target amount" />}
          {targetType !== "binary" && <input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder={targetType === "duration" ? "minutes" : "times"} className="ass-input habit-unit" aria-label="Target unit" />}
          <button type="button" onClick={createHabit} className="ass-primary-button">Add</button>
        </div>
      </section>

      {habits.some((habit) => habit.paused) && <section className="product-section"><div className="section-heading"><h2>Paused</h2></div><div className="habit-list">{habits.filter((habit) => habit.paused).map((habit) => <HabitCard key={habit.id} habit={habit} onToggle={toggleHabit} onDelete={deleteHabit} onUpdate={updateHabit} />)}</div></section>}
    </main>
  );
}
