import re
import subprocess

def check_div_matching():
    # Get index.html from git
    content = subprocess.check_output(['git', 'show', '63ee3cc:index.html']).decode('utf-8')

    lines = content.splitlines()
    stack = []
    
    for line_num, line in enumerate(lines, 1):
        tokens = re.finditer(r'<(div|/div)\b', line)
        for token in tokens:
            tag = token.group(1)
            if tag == 'div':
                id_match = re.search(r'id=["\']([^"\']+)["\']', line[token.start():token.start()+200])
                div_id = id_match.group(1) if id_match else None
                class_match = re.search(r'class=["\']([^"\']+)["\']', line[token.start():token.start()+200])
                div_class = class_match.group(1)[:30] + '...' if class_match else None
                stack.append((line_num, div_id, div_class))
            elif tag == '/div':
                if not stack:
                    print(f"Error: Extra closing </div> at line {line_num}")
                else:
                    open_line, open_id, open_class = stack.pop()
                    if len(stack) <= 1:
                        print(f"Close tag at line {line_num} closes div from line {open_line} (id: {open_id}, class: {open_class})")

    print("\n--- Unclosed tags in stack ---")
    for open_line, open_id, open_class in reversed(stack):
        print(f"Unclosed div at line {open_line} (id: {open_id}, class: {open_class})")

if __name__ == '__main__':
    check_div_matching()
