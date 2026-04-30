'use client';
import { useState, useEffect } from 'react';

const KEY = 'voluma_user_id';

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `u_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}


export function useUserId(): string {
  const [userId, setUserId] = useState('');

  useEffect(() => {
  let id = localStorage.getItem(KEY);

  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }

  setUserId(id);
}, []);

  return userId;
}