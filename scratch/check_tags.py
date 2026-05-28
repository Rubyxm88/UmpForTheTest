import re

def check_div_matching():
    with open('index.html', 'r', encoding='utf-8') as f:
        content = f.read()

    # Find all divs, custom tags, and comments
    # We want to trace <div> and </div> tags specifically.
    lines = content.splitlines()
    stack = []
    
    for line_num, line in enumerate(lines, 1):
        # Find all <div or </div
        # Simple regex to catch div opens and closes
        tokens = re.finditer(r'<(div|/div)\b', line)
        for token in tokens:
            tag = token.group(1)
            # Find the full tag if open
            if tag == 'div':
                # Extract id if present
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
                    # Print progress for top level elements
                    if len(stack) <= 1:
                        print(f"Close tag at line {line_num} closes div from line {open_line} (id: {open_id}, class: {open_class})")

    print("\n--- Unclosed tags in stack ---")
    for open_line, open_id, open_class in reversed(stack):
        print(f"Unclosed div at line {open_line} (id: {open_id}, class: {open_class})")

if __name__ == '__main__':
    check_div_matching()
