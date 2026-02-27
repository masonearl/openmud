"""
openmud Schedule Tools
Build construction schedules with phases and dates.
"""

from datetime import datetime, timedelta
from typing import List, Optional


def parse_phases(phases_str: str) -> List[str]:
    """Parse comma-separated phase string into list."""
    if not phases_str or not phases_str.strip():
        return ["Mobilization", "Trenching", "Pipe install", "Backfill", "Restoration"]
    return [p.strip() for p in phases_str.split(",") if p.strip()]


def build_schedule(
    project_name: str,
    duration_days: int,
    start_date: Optional[str] = None,
    phases: Optional[List[str]] = None,
) -> dict:
    """
    Build a construction schedule with phases and dates.

    Args:
        project_name: Name of the project
        duration_days: Total duration in days
        start_date: ISO date string (YYYY-MM-DD) or None for today
        phases: List of phase names or None for default

    Returns:
        dict with project_name, duration, phases (list of {phase, start, end, days}), and table_html
    """
    phases = phases or parse_phases("")
    start = datetime.strptime(start_date, "%Y-%m-%d") if start_date else datetime.now()
    duration_days = max(1, int(duration_days))
    days_per_phase = max(1, duration_days // len(phases))

    rows = []
    d = start
    for i, phase in enumerate(phases):
        phase_days = (
            duration_days - (len(phases) - 1) * days_per_phase
            if i == len(phases) - 1
            else days_per_phase
        )
        end = d + timedelta(days=phase_days - 1)
        rows.append(
            {
                "phase": phase,
                "start": d.strftime("%m/%d/%Y"),
                "end": end.strftime("%m/%d/%Y"),
                "days": phase_days,
            }
        )
        d = end + timedelta(days=1)

    # Build table HTML
    table = (
        '<table style="width:100%;border-collapse:collapse;">'
        '<tr style="background:#f0f0f0;"><th style="padding:10px;text-align:left;">Phase</th>'
        "<th>Start</th><th>End</th><th>Days</th></tr>"
    )
    for r in rows:
        table += (
            f'<tr><td style="padding:10px;border-bottom:1px solid #ddd;">{r["phase"]}</td>'
            f'<td style="padding:10px;border-bottom:1px solid #ddd;">{r["start"]}</td>'
            f'<td style="padding:10px;border-bottom:1px solid #ddd;">{r["end"]}</td>'
            f'<td style="padding:10px;border-bottom:1px solid #ddd;">{r["days"]}</td></tr>'
        )
    table += "</table>"

    return {
        "project_name": project_name,
        "duration": duration_days,
        "phases": rows,
        "table_html": table,
    }
