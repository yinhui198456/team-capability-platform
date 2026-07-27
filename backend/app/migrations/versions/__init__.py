from .v0001_standard_targets import upgrade as upgrade_standard_targets
from .v0002_assessment_inheritance_revision import (
    upgrade as upgrade_assessment_inheritance_revision,
)
from .v0003_assessment_explicit_clear import (
    upgrade as upgrade_assessment_explicit_clear,
)

MIGRATIONS = [
    ("0001_standard_targets", upgrade_standard_targets),
    (
        "0002_assessment_inheritance_revision",
        upgrade_assessment_inheritance_revision,
    ),
    ("0003_assessment_explicit_clear", upgrade_assessment_explicit_clear),
]

__all__ = ["MIGRATIONS"]
