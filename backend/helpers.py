"""Small helpers shared by the route modules."""
import math
from datetime import date, datetime

import pandas as pd


def clean_nan(value):
    """Make a value JSON-safe: NaN/NaT/inf -> None, dates -> ISO strings."""
    if isinstance(value, dict):
        return {k: clean_nan(v) for k, v in value.items()}

    if isinstance(value, (list, tuple)):
        return [clean_nan(v) for v in value]

    if isinstance(value, float):
        return None if (math.isnan(value) or math.isinf(value)) else value

    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass

    if isinstance(value, (datetime, date)):
        return value.isoformat()

    return value
