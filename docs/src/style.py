from pygments.styles.default import DefaultStyle
from pygments_ansi_color import color_tokens

class DefaultAnsiStyle(DefaultStyle):
    styles = dict(DefaultStyle.styles)
    styles.update(color_tokens())
