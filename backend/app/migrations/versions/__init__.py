from .v0001_standard_targets import upgrade as upgrade_standard_targets
from .v0002_assessment_inheritance_revision import (
    upgrade as upgrade_assessment_inheritance_revision,
)

MIGRATIONS = [
    ("0001_standard_targets", upgrade_standard_targets),
    (
        "0002_assessment_inheritance_revision",
        upgrade_assessment_inheritance_revision,
    ),
]

__all__ = ["MIGRATIONS"]
