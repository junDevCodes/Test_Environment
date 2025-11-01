from __future__ import annotations

from typing import Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout


def grade_with_gemini(question_text: str, model_answer: str, user_answer: str, api_key: str, timeout_seconds: float = 8.0) -> Optional[Tuple[bool, float, str]]:
    """
    Attempt to grade using Gemini. Returns (is_correct, score, reason) or None on failure/unavailable.
    - score: 0.0 to 1.0
    """
    try:
        import google.generativeai as genai  # type: ignore
    except Exception:
        return None

    try:
        genai.configure(api_key=api_key)
        # Prefer a fast model for grading; users can adjust to pro if needed.
        model = genai.GenerativeModel("gemini-1.5-flash")

        system_prompt = (
            "You are a strict grader. Given a question, a reference model answer, and a student's answer, "
            "evaluate correctness and produce a numeric score from 0.0 to 1.0. Be concise and fair. "
            "Output only valid JSON with keys: is_correct (boolean), score (number 0..1), reason (string)."
        )

        user_prompt = (
            f"Question: {question_text}\n\n"
            f"Reference Answer: {model_answer}\n\n"
            f"Student Answer: {user_answer}\n\n"
            "Return JSON only."
        )

        # Some SDKs support response_mime_type; guard if unsupported
        def _call_gen():
            try:
                return model.generate_content([
                    {"role": "user", "parts": system_prompt},
                    {"role": "user", "parts": user_prompt},
                ], generation_config={"response_mime_type": "application/json"})
            except Exception:
                return model.generate_content([
                    system_prompt,
                    user_prompt,
                ])

        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_call_gen)
            try:
                response = fut.result(timeout=timeout_seconds)
            except FuturesTimeout:
                return None

        text = getattr(response, "text", None) or str(response)

        import json
        data = json.loads(text)
        is_correct = bool(data.get("is_correct"))
        score = float(data.get("score", 0.0))
        reason = str(data.get("reason", ""))
        # Clamp score
        score = max(0.0, min(1.0, score))
        return is_correct, score, reason
    except Exception:
        return None
