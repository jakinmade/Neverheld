"use client";
import { useState } from "react";
export default function Page() {
  const [count, setCount] = useState(0);
  return (<main><h1>Next.js fixture</h1><button id="hydrated" onClick={() => setCount(count + 1)}>clicked {count}</button><input id="file" type="file" /></main>);
}
