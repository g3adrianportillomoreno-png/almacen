import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://zlbdozidauhuekbvcmif.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsYmRvemlkYXVodWVrYnZjbWlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3NTA2MTYsImV4cCI6MjEwNjMyNjYxNn0.5rfHaJNJj3M7hjpJ8g7EdpMv157Z-mZeXeChEAv2BfM';

export const supabase = createClient(supabaseUrl, supabaseKey);
